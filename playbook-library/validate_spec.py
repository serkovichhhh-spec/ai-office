"""Structural integrity checks only; not a general JSON Schema validator."""
import json, pathlib, sys
import yaml

root=pathlib.Path(__file__).resolve().parent
playbooks=list(yaml.safe_load_all((root/'playbooks.yaml').read_text()))
schemas=json.loads((root/'schemas.json').read_text())
briefs=json.loads((root/'brief-schemas.json').read_text())['$defs']
registry=json.loads((root/'registry.json').read_text())['playbooks']
defs=schemas['$defs']
required={'playbook_key','title','use_when','brief_fields','steps','review','package','handoff','risks'}
step_fields={'key','seat','executor','depends_on','inputs','task','output_schema','quality_checks'}
seats={'orchestrator','strategist','research_analyst','performance_analyst','creative_director','creative','copywriter','smm','content_maker','reviewer','designer','graphic_designer','print_designer','video_editor','scriptwriter','ads_specialist'}
assert len(playbooks)==12
assert len({p['playbook_key'] for p in playbooks})==12
assert len([m for m in registry if m['priority']=='P1'])==5

def check_schema(s):
 if isinstance(s,list):
  for x in s: check_schema(x)
 elif isinstance(s,dict):
  if '$ref' in s:
   assert s['$ref'].startswith('#/$defs/')
   assert s['$ref'].split('/')[-1] in defs
  if s.get('type')=='object':
   assert s['additionalProperties'] is False
   assert set(s['required'])==set(s['properties'])
  if 'minItems' in s and 'maxItems' in s: assert s['minItems']<=s['maxItems']
  for v in s.values(): check_schema(v)
check_schema(schemas)

for p,m in zip(playbooks,registry):
 assert set(p)==required
 assert p['playbook_key']==m['playbook_key']
 assert len(p['steps'])==2
 known=set()
 for st in p['steps']:
  assert set(st)==step_fields
  assert st['seat'] in seats
  assert st['executor'] in ['chatgpt','claude_session','human','code']
  assert set(st['depends_on'])<=known
  for inp in st['inputs']:
   if inp.startswith('artifact:'): assert inp[9:] in known
  known.add(st['key'])
  assert st['output_schema']['$ref'].startswith('schemas.json#/$defs/')
  assert st['output_schema']['$ref'].split('/')[-1] in defs
 assert p['review']['send_back_to'] in known
 assert all(p['review']['executor'] != st['executor'] for st in p['steps'])
 assert len(p['review']['criteria'])==5
 assert len({c['key'] for c in p['review']['criteria']})==5
 final=defs[p['steps'][-1]['output_schema']['$ref'].split('/')[-1]]['properties']
 assert m['main_output'] in final
 for name in p['package']['sections']: assert name in final or name=='review'
 for name in p['handoff']['payload']: assert name in final or name in ['review','approved_manifest']
 bs=briefs[p['playbook_key']]
 assert set(bs['required'])<=set(bs['properties'])
 assert bs['properties']['deliverable_count']['maximum']==m['deliverable_count_max']
 for f in p['brief_fields']:
  assert set(f)=={'key','type','required','hint'}
  assert f['key'] in bs['properties']
  assert (f['key'] in bs['required'])==f['required']
  if f['type']=='enum': assert 'enum' in bs['properties'][f['key']]
print(f'PASS: {len(playbooks)} playbooks, {len(defs)} schema definitions, 5 P1; refs, fields, DAGs, independent reviewers, package/handoff mappings.')
