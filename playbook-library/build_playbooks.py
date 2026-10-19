import json, pathlib, yaml, zipfile

ROOT = pathlib.Path(__file__).resolve().parent
ROOT.mkdir(exist_ok=True)
DEFS = {}
def S(n=1000, m=1): return {'type':'string','minLength':m,'maxLength':n}
def E(*v): return {'type':'string','enum':list(v)}
def N(lo=0, hi=1000000000): return {'type':'number','minimum':lo,'maximum':hi}
def I(lo=0, hi=100): return {'type':'integer','minimum':lo,'maximum':hi}
def R(name): return {'$ref':'#/$defs/'+name}
def A(t,lo=0,hi=30): return {'type':'array','items':t,'minItems':lo,'maxItems':hi}
def O(**p): return {'type':'object','additionalProperties':False,'required':list(p),'properties':p}
def nullable(t): return {'anyOf':[t,{'type':'null'}]}
def D(name, **p): DEFS[name]=O(**p); return R(name)
STRINGS=lambda hi=30: A(S(1000),0,hi)
D('KnowledgeRef',record_id=S(100),version=S(100),pointer=S(300))
D('SourceUse',output_pointer=S(400),refs=A(R('KnowledgeRef'),1,10),derivation=nullable(S(1000)))
D('Claim',id=S(80),text=S(1500),needed_evidence=S(1000),disposition=E('excluded','placeholder'),affected_pointer=nullable(S(400)))
D('Hypothesis',id=S(80),statement=S(1500),validation=S(1000))
D('WorkItem',id=S(80),title=S(160),action=S(2000),rationale=S(1500),audience=S(1000),dependencies=STRINGS(20),source_refs=A(R('KnowledgeRef'),0,20))
D('CopyVariant',id=S(80),placement=S(120),headline=S(180),body=S(12000,0),cta=S(200),destination=nullable(S(2048)),source_refs=A(R('KnowledgeRef'),0,20))
D('Concept',id=S(80),title=S(160),insight_hypothesis=S(1200),idea=S(2000),hook=S(400),message=S(700),visual_direction=S(2000),rationale=S(1200),source_refs=A(R('KnowledgeRef'),0,20))
D('FormatSpec',id=S(80),channel=S(120),placement=S(120),width=nullable(I(1,100000)),height=nullable(I(1,100000)),unit=E('px','mm'),aspect_ratio=nullable(S(40)),duration_seconds=nullable(N(0.1,3600)),safe_area=S(1000),export_spec=S(1500),source_refs=A(R('KnowledgeRef'),0,20))
D('AssetUse',asset_id=S(100),version=S(100),purpose=S(500),rights_knowledge_refs=A(R('KnowledgeRef'),1,10))
D('GenerationPrompt',id=S(80),purpose=S(200),prompt=S(6000),avoid=S(2000),reference_assets=A(R('AssetUse'),0,20),text_overlay_instruction=S(1000))
D('DesignBrief',id=S(80),concept=R('Concept'),composition=S(3000),hierarchy=A(S(600),1,12),copy=A(R('CopyVariant'),1,20),brand_knowledge_refs=A(R('KnowledgeRef'),1,20),asset_uses=A(R('AssetUse'),0,20),formats=A(R('FormatSpec'),1,12),generation_prompts=A(R('GenerationPrompt'),0,8),accessibility_checks=A(S(800),1,20),production_checks=A(S(800),1,30))
D('CreativeSpec',id=S(80),design=R('DesignBrief'),adaptation_rules=A(S(800),1,20),file_naming=S(300))
D('MeasurementPlan',objective=S(1000),primary_metric=S(200),definition=S(1500),approved_target=nullable(N()),target_knowledge_refs=A(R('KnowledgeRef'),0,10),collection=S(1500),attribution_limitations=A(S(1000),1,20),decision_rule=S(1500))
D('ContentPlanItem',id=S(80),scheduled_at=S(80),channel=S(120),format=E('post','stories','reel','video','carousel','live'),pillar=S(150),topic=S(500),goal=S(700),hook_hypothesis=S(700),cta=S(200),production_needs=A(S(1000),0,20),measurement=R('MeasurementPlan'),source_refs=A(R('KnowledgeRef'),0,20))
D('StoryFrame',order=I(1,30),on_screen_text=S(500),visual=S(1500),interaction=nullable(S(500)),duration_seconds=N(0.1,60))
D('Shot',order=I(1,500),start_seconds=N(0,3600),end_seconds=N(0.1,3600),visual=S(2000),voiceover=S(2000,0),on_screen_text=S(1000,0),audio=S(1000),edit_notes=S(1500),source_refs=A(R('KnowledgeRef'),0,20))
D('CaptureBrief',locations=A(S(500),1,20),people=A(S(500),0,30),props=A(S(500),0,30),shots=A(R('Shot'),1,500),permissions=A(S(1000),0,30),fallback=S(2000))
D('SocialUnit',id=S(80),channel=S(120),kind=E('post','stories','carousel','short_video'),copy=R('CopyVariant'),frames=A(R('StoryFrame'),0,30),capture_brief=nullable(R('CaptureBrief')),design_brief=nullable(R('DesignBrief')),accessibility=A(S(700),1,20),measurement=R('MeasurementPlan'))
D('VideoScript',id=S(80),title=S(160),duration_seconds=N(1,3600),hook=S(1000),shots=A(R('Shot'),1,500),caption=R('CopyVariant'),formats=A(R('FormatSpec'),1,12),capture_brief=R('CaptureBrief'),generation_prompts=A(R('GenerationPrompt'),0,8),rights_checks=A(S(1000),1,30))
D('ArtDirection',id=S(80),concept=R('Concept'),design_brief=R('DesignBrief'),system_rules=A(S(1500),1,30),channel_adaptations=A(S(1500),1,20),do_not=A(S(1000),1,20))
D('ConceptSelection',concept=R('Concept'),brief_score=I(1,5),distinctiveness_score=I(1,5),feasibility_score=I(1,5),evidence_score=I(1,5),weighted_score=N(1,5),selected={'type':'boolean'},reason=S(1500),validation_plan=S(1500))
D('BudgetLine',ad_set_id=S(80),share_percent=N(0,100),amount=nullable(N()),currency=nullable(E('UAH','USD','EUR')),budget_knowledge_refs=A(R('KnowledgeRef'),0,10))
D('ABHypothesis',id=S(80),ad_set_id=S(80),variable=S(300),control=S(1500),variant=S(1500),success_metric=S(300),decision_rule=S(1500),minimum_evidence=S(1000),spend_guardrail=S(1000))
D('AdSetPlan',id=S(80),platform=E('meta','google'),campaign_id=S(80),objective=S(500),geo_knowledge_refs=A(R('KnowledgeRef'),1,30),audience_hypothesis=S(2000),exclusions=A(S(700),0,30),placements=A(S(300),1,30),ad_ids=A(S(80),1,30),keywords=A(S(300),0,200),negative_keywords=A(S(300),0,200),settings_to_verify=A(S(1000),0,30))
D('Ad',id=S(80),ad_set_id=S(80),copy_variants=A(R('CopyVariant'),1,10),creative=nullable(R('CreativeSpec')),platform_constraints_knowledge_refs=A(R('KnowledgeRef'),1,20))
D('PaidMediaStructure',campaign_ids=A(S(80),1,20),ad_sets=A(R('AdSetPlan'),1,100),budget=A(R('BudgetLine'),1,100),experiments=A(R('ABHypothesis'),0,30),measurement=R('MeasurementPlan'),launch_checklist=A(S(1000),1,40))
D('PrintSpec',id=S(80),medium=E('billboard','citylight','flyer','a4','other'),design=R('DesignBrief'),supplier_knowledge_refs=A(R('KnowledgeRef'),1,20),trim_mm=S(100),bleed_mm=N(0,100),safe_margin_mm=N(0,1000),color_profile=S(300),resolution_dpi=I(1,5000),scale=S(100),finishing=S(1000),proof_checks=A(S(1000),1,30),response_tracking=R('MeasurementPlan'))
D('LaunchTask',id=S(80),channel=S(120),action=S(2000),responsible_role=S(100),deadline=S(80),depends_on=A(S(80),0,30),acceptance=S(1500),rollback=S(1500))
D('LaunchUnit',id=S(80),channel=S(120),message=R('CopyVariant'),production_brief=S(3000),support_faq=A(S(1200),0,30))
D('Calculation',id=S(80),metric=S(200),formula=S(500),input_refs=A(R('KnowledgeRef'),1,20),substituted_expression=S(700),value=nullable(N(-1000000000000,1000000000000)),unit=S(80),null_reason=nullable(S(1000)),limitations=A(S(1000),0,20))
D('Finding',id=S(80),statement=S(2500),classification=E('fact','derived','hypothesis','unavailable'),source_refs=A(R('KnowledgeRef'),0,30),calculation_ids=A(S(80),0,30),confidence=E('high','medium','low','unavailable'),limitation=S(1500))
D('Action',id=S(80),action=S(2000),priority=E('P1','P2','P3'),responsible_role=S(100),deadline=nullable(S(80)),decision_rule=S(1500),finding_ids=A(S(80),0,30))
D('CompetitorRow',competitor_id=S(100),dimension=S(150),observed_value=nullable(S(2000)),observed_at=nullable(S(80)),source_refs=A(R('KnowledgeRef'),0,20),status=E('verified','unavailable'))
D('ResearchCandidate',url=S(2048),retrieved_at=S(80),excerpt=S(1000),proposed_fact=S(1500),needs_owner_approval={'const':True})
D('OwnedCopyUnit',id=S(80),kind=E('website','landing','email','sms','pr','ivr','faq'),copy=R('CopyVariant'),subject=nullable(S(250)),preheader=nullable(S(300)),sections=A(S(5000),0,30),metadata=A(S(1000),0,20),delivery_checks=A(S(1000),1,30),measurement=R('MeasurementPlan'))

COMMON={
 'status':E('ready','blocked'),'summary':S(1500),
 'source_uses':A(R('SourceUse'),0,300),'claims_needing_source':A(R('Claim'),0,100),
 'assumptions':A(R('Hypothesis'),0,50),'blocking_questions':A(S(1000),0,30)}
def output(name, props, main, minimum=1):
    schema=O(**COMMON,**props)
    ready={'properties':{'blocking_questions':{'maxItems':0}, main: {'minItems':minimum}}}
    if props[main].get('type')!='array': ready['properties'][main]={'not':{'type':'null'}}
    schema['allOf']=[{'if':{'properties':{'status':{'const':'ready'}}},'then':ready}]
    DEFS[name]=schema
output('Preparation',{'work_items':A(R('WorkItem'),0,100),'constraints':A(S(1500),0,50),'measurement':nullable(R('MeasurementPlan'))},'work_items')
output('ContentPlanOutput',{'items':A(R('ContentPlanItem'),0,100),'cadence_rationale':S(2000),'production_dependencies':A(S(1500),0,40)},'items')
output('SocialPackOutput',{'units':A(R('SocialUnit'),0,30),'publishing_checklist':A(S(1000),0,40)},'units')
output('GraphicsOutput',{'creatives':A(R('CreativeSpec'),0,30),'export_checklist':A(S(1000),0,40)},'creatives')
output('ArtDirectionOutput',{'directions':A(R('ArtDirection'),0,3),'recommended_direction_id':nullable(S(80))},'directions')
output('IdeationPreparation',{'candidates':A(R('Concept'),0,12),'selection_weights':O(brief=N(0,1),distinctiveness=N(0,1),feasibility=N(0,1),evidence=N(0,1))},'candidates',6)
output('IdeationOutput',{'ranked_candidates':A(R('ConceptSelection'),0,12),'selected_ids':A(S(80),0,5),'discard_reasons':A(S(1500),0,12)},'ranked_candidates',6)
output('PaidMediaOutput',{'structure':nullable(R('PaidMediaStructure')),'ads':A(R('Ad'),0,30)},'ads')
output('ScriptsOutput',{'scripts':A(R('VideoScript'),0,10),'production_checklist':A(S(1000),0,40)},'scripts')
output('PrintOutput',{'layouts':A(R('PrintSpec'),0,10),'supplier_questions':A(S(1000),0,30)},'layouts')
output('LaunchOutput',{'units':A(R('LaunchUnit'),0,20),'tasks':A(R('LaunchTask'),0,100),'measurement':nullable(R('MeasurementPlan')),'readiness_checklist':A(S(1000),0,40)},'units')
output('AnalysisOutput',{'findings':A(R('Finding'),0,30),'calculations':A(R('Calculation'),0,100),'actions':A(R('Action'),0,30),'data_quality':A(S(1500),0,40)},'findings')
output('CompetitorOutput',{'rows':A(R('CompetitorRow'),0,100),'findings':A(R('Finding'),0,30),'actions':A(R('Action'),0,30),'research_candidates':A(R('ResearchCandidate'),0,30)},'rows')
output('OwnedCopyOutput',{'units':A(R('OwnedCopyUnit'),0,30),'delivery_checklist':A(S(1000),0,40)},'units')
D('ReviewCriterionScore',key=S(80),score=I(1,5),evidence_pointer=S(400),reason=S(1500))
D('ReviewIssue',id=S(80),severity=E('critical','major','minor'),artifact_pointer=S(400),fragment=S(1500),criterion=S(80),fix=S(2000),resolution=E('open','resolved'))
D('ReviewDecision',decision=E('pass','revise','escalate'),reviewed_artifact_id=S(100),reviewed_version=S(100),scores=A(R('ReviewCriterionScore'),5,5),issues=A(R('ReviewIssue'),0,50),resolved_issue_ids=A(S(80),0,50),summary=S(2000))
D('VersionRef',id=S(100),version=S(100),hash={'type':'string','pattern':'^[a-f0-9]{64}$'})
D('ContentManifest',run_id=S(100),playbook_key=S(100),playbook_version=I(1,100000),brief_ref=R('VersionRef'),knowledge_snapshot_ref=R('VersionRef'),artifact_refs=A(R('VersionRef'),2,3),review_ref=R('VersionRef'))
D('Approval',id=S(100),decision=E('approve','request_changes','reject','resolve_inputs'),actor_id=S(100),decided_at={**S(80),'format':'date-time'},run_id=S(100),content_manifest_hash={'type':'string','pattern':'^[a-f0-9]{64}$'},comment=S(3000,0))
D('ApprovedManifest',content=R('ContentManifest'),content_manifest_hash={'type':'string','pattern':'^[a-f0-9]{64}$'},approval_id=S(100),approved_by=S(100),approved_at={**S(80),'format':'date-time'})
D('OwnerPackage',state=E('blocked','escalated','ready_for_approval'),run_id=S(100),final_artifact=nullable(R('VersionRef')),review_ref=nullable(R('VersionRef')),section_keys=A(S(100),1,30),blocking_reasons=A(S(1500),0,50),content_manifest=nullable(R('ContentManifest')))
D('HandoffReceipt',status={'const':'handoff_ready'},destination=E('graphic_designer','video_editor','print','ads_manager','smm','human'),approved_manifest=R('ApprovedManifest'),payload_artifact=R('VersionRef'),idempotency_key=S(300),created_at={**S(80),'format':'date-time'})

def F(key,typ,required,hint): return dict(key=key,type=typ,required=required,hint=hint)
def listfield(k,h,req=True): return F(k,'list',req,h)
def enumfield(k,opts,req=True): return F(k,'enum',req,'Оберіть одне: '+', '.join(opts)+'.')
def textfield(k,h,req=True): return F(k,'string',req,h)
def criteria(special):
 return [
 {'key':'evidence','what':'Усі фактичні твердження мають чинні knowledge refs; похідні цифри відтворюються.','pass_if':'score == 5'},
 {'key':'brief_fit','what':'Досягнута мета, виконані обсяг, канал і acceptance_criteria.','pass_if':'score >= 4'},
 {'key':'brand','what':'Бренд, маскот, шрифт, тон і CTA відповідають pinned knowledge; для аналітики збережена термінологія.','pass_if':'score >= 4'},
 {'key':'execution','what':'Пакет можна виконати без вигаданих налаштувань, даних, активів і відповідальних.','pass_if':'score >= 4'},
 {'key':'specialist','what':special,'pass_if':'score >= 4'}]

PLAYBOOKS=[]; META=[]
def add(key,title,use,fields,author,prep_task,build_task,out,checks,special,to,payload,risks,priority,count_main,count_max,sections):
 reviewer='claude_session' if author=='chatgpt' else 'chatgpt'
 def step(k,seat,deps,ins,task,schema,q):
  return dict(key=k,seat=seat,executor=author,depends_on=deps,inputs=ins,task=task,output_schema={'$ref':'schemas.json#/$defs/'+schema},quality_checks=q)
 prepare_seat,build_seat=checks[0],checks[1]
 common=' Використовуйте лише затверджені knowledge для фактів; решту винесіть у claims_needing_source. За браку обов’язкового входу поверніть status=blocked і точні blocking_questions.'
 p=dict(playbook_key=key,title=title,use_when=use,brief_fields=fields,steps=[
  step('prepare',prepare_seat,[],['brief','knowledge'],prep_task+common,'IdeationPreparation' if key=='creative_ideation' else 'Preparation',['Повнота входів та межі задачі','Версії knowledge й джерела тверджень','Реалістичність запропонованого плану']),
  step('build',build_seat,['prepare'],['brief','knowledge','artifact:prepare'],build_task+common,out,checks[2:])],
 review=dict(seat='reviewer',executor=reviewer,criteria=criteria(special),send_back_to='build'),
 package=dict(sections=['summary']+sections+['claims_needing_source','assumptions','blocking_questions','source_uses','review']),
 handoff=dict(to=to,payload=payload+['source_uses','claims_needing_source','assumptions','blocking_questions','review','approved_manifest']),risks=risks)
 PLAYBOOKS.append(p)
 META.append(dict(playbook_key=key,priority=priority,version=2 if key=='reels_concepts' else 1,main_output=count_main,deliverable_count_max=count_max,author_executor=author,review_executor=reviewer))

add('smm_content_plan','Контент-план SMM','Для календаря контенту й завдань команді на визначений період. Готові публікації створює social_content_pack.',[
 textfield('period_start','Дата YYYY-MM-DD.'),textfield('period_end','Дата YYYY-MM-DD; період до 93 днів.'),listfield('channels','1-5 рядків: канали публікацій.'),listfield('pillars','1-12 рубрик.',False),listfield('capacity_knowledge_ids','1-10 ID затверджених ресурсних обмежень.'),listfield('events_knowledge_ids','0-30 ID підтверджених подій.',False)],
 'chatgpt','Визначте рубрики, цілі та логіку чергування. Зіставте обсяг із ресурсами й підтвердженими подіями. Сформуйте work_items для майбутніх публікацій.',
 'Створіть рівно deliverable_count елементів календаря. Для кожного задайте дату з часовим поясом, мету, гачок-гіпотезу, CTA та вимоги продакшну. Додайте вимірювання й залежності; готові тексти тут не потрібні.',
 'ContentPlanOutput',['smm','smm','Дати в періоді, канал у brief.channels','Кількість items дорівнює deliverable_count','Навантаження не перевищує knowledge-ліміти'],
 'Календар різноманітний, забезпечений ресурсами й має перевірювані цілі.','smm',['items','cadence_rationale','production_dependencies'],['Непосильна частота: перевірити capacity','Вигадані інфоприводи: лише knowledge','Непідтверджений прогноз охоплення: лише гіпотеза'],'P2','items',100,['items','cadence_rationale','production_dependencies'])

add('social_content_pack','Пости, сторіз і контент-мейкінг','Для готових соціальних публікацій, серій сторіз, каруселей та завдань на зйомку. Окремий відеосценарій обирайте через reels_concepts.',[
 enumfield('content_kind',['post','stories','carousel','short_video']),listfield('channels','1-5 каналів.'),listfield('plan_item_ids','0-30 ID елементів затвердженого плану.',False),listfield('available_asset_ids','0-30 доступних активів.',False),textfield('production_constraints','Локація, люди, час; 1-3000 символів.'),listfield('platform_spec_knowledge_ids','1-10 ID актуальних обмежень форматів.')],
 'claude_session','Визначте меседж кожної публікації та роль у комунікації. Зіставте задум із доступними активами та можливостями зйомки. Опишіть work_items без повторення одного сюжету.',
 'Підготуйте рівно deliverable_count одиниць контенту. Для сторіз або каруселі розкладіть матеріал на послідовні frames; для зйомки заповніть capture_brief. Додайте остаточні тексти, доступність і правила вимірювання.',
 'SocialPackOutput',['smm','content_maker','Тексти поміщаються у підтверджені формати','Сторіз і карусель мають frames; зйомка має capture_brief','units рівно deliverable_count, без дублювання'],
 'Зрозумілий перший кадр, логічна послідовність, конкретне завдання на зйомку.','smm',['units','publishing_checklist'],['Змішування одиниці й кадру: count рахує units','Немає активів: передбачити зйомку або blocked','Чужа музика чи обличчя: перевірити права'],'P2','units',30,['units','publishing_checklist'])

add('graphic_design_pack','Графічні креативи й банери','Для ТЗ на цифрові банери, рекламні та соціальні макети. Друковані носії веде outdoor_print_pack.',[
 listfield('placements','1-12 точних місць розміщення.'),listfield('format_knowledge_ids','1-12 ID технічних специфікацій.'),listfield('asset_ids','0-30 доступних активів.',False),textfield('art_direction_artifact_id','ID затвердженого артнапряму або порожнє поле.',False),listfield('required_copy','0-20 рядків обов’язкового тексту; факти мають бути в knowledge.',False)],
 'claude_session','Визначте візуальну ієрархію й меседж. Перевірте доступність бренд-активів та специфікацій розміщення. Опишіть work_items як окремі креативи, а формати як їх адаптації.',
 'Видайте рівно deliverable_count creative_spec. Заповніть композицію, фінальні тексти, формати, адаптації та чеклісти. Промпти описують генерацію зображення, а текст і затверджені бренд-активи накладаються у продакшні.',
 'GraphicsOutput',['creative_director','graphic_designer','Кожний формат має knowledge refs','Оригінальні бренд-активи задані через asset_id/version','creatives рівно deliverable_count'],
 'Читабельна ієрархія, коректні адаптації та здійсненний продакшн.','graphic_designer',['creatives','export_checklist'],['AI перемальовує маскота: заборона в prompts','Нечитабельна мобільна версія: safe area і QA','Вигадані розміри: blocked без специфікацій'],'P1','creatives',30,['creatives','export_checklist'])

add('campaign_art_direction','Візуальна система кампанії','Для розробки 1-3 візуальних напрямів і правил адаптації кампанії. Фінальні макети замовляються окремим плейбуком після вибору напряму.',[
 listfield('campaign_channels','1-12 каналів.'),listfield('mandatory_asset_ids','0-30 активів.',False),textfield('visual_constraints','Обмеження й бажана відмінність; 1-3000 символів.'),listfield('reference_notes','0-20 коментарів до референсів.',False)],
 'claude_session','Виділіть незмінні бренд-елементи й простір для експерименту. Визначте принципи, за якими напрями будуть відрізнятися. Опишіть work_items для кожного напряму.',
 'Створіть рівно deliverable_count напрямів, максимум три. Для кожного дайте concept, design_brief, системні правила, адаптації й do_not. Рекомендуйте один напрям із поясненням у summary, не оголошуючи його затвердженим.',
 'ArtDirectionOutput',['creative_director','creative_director','Напрями відрізняються композиційною ідеєю','recommended_direction_id існує у directions','Бренд збережений у всіх каналах'],
 'Система масштабується на всі канали, відмінності між напрямами суттєві.','graphic_designer',['directions','recommended_direction_id'],['Косметичні варіанти: порівняти принципи','Редизайн бренду без задачі: перевірити brand refs','Мудборд без правил: обов’язкові adaptations'],'P2','directions',3,['directions','recommended_direction_id'])

add('creative_ideation','Генерація та відбір ідей','Для пошуку механіки, ключової ідеї, гачка або назви. Результат містить ранжування та рекомендацію, а не фінальний макет.',[
 enumfield('idea_kind',['campaign','activation','hook','naming','mechanic']),F('candidate_count','number',True,'Ціле 6-12; не менше deliverable_count.'),textfield('creative_boundaries','Що дозволено й заборонено; 1-3000 символів.'),listfield('rejected_ideas','0-30 раніше відхилених ідей.',False)],
 'claude_session','Створіть рівно candidate_count різних концепцій. Позначайте інсайти як гіпотези, якщо їх не підтверджує knowledge. Застосуйте ваги brief=0.35, distinctiveness=0.25, feasibility=0.25, evidence=0.15.',
 'Оцініть усі вихідні концепції за чотирма критеріями 1-5 та відсортуйте. Оберіть рівно deliverable_count ідей, максимум п’ять; збережіть ID і поясніть відмову від решти. Для кожної запропонуйте дешеву перевірку гіпотези без обіцянок результату.',
 'IdeationOutput',['creative','creative','Кандидати рівно candidate_count зі збереженими ID','Ваги та weighted_score перераховано кодом','selected_ids рівно deliverable_count'],
 'Ідеї різні за механікою, відповідають обмеженням і мають план перевірки.','human',['ranked_candidates','selected_ids','discard_reasons'],['Самовідбір слабких ідей: незалежне рев’ю','Обіцянка унікальності назви: лише потреба перевірки','Повтор відхиленого: перевірка rejected_ideas'],'P2','selected_ids',5,['ranked_candidates','selected_ids','discard_reasons'])

add('paid_media_campaign','План Meta Ads або Google Ads','Для структури однієї рекламної кампанії, аудиторних гіпотез, оголошень та A/B-перевірок. Один запуск плейбука охоплює одну платформу без фактичного запуску реклами.',[
 enumfield('platform',['meta','google']),textfield('offer_knowledge_id','ID затвердженої пропозиції.'),listfield('geo_knowledge_ids','1-30 ID допустимої географії.'),textfield('budget_knowledge_id','ID бюджету або затвердження режиму лише відсотків.'),textfield('conversion_knowledge_id','ID підтвердженого стану відстежування й допустимої оптимізації.'),listfield('platform_spec_knowledge_ids','1-20 ID актуальних обмежень платформи.'),textfield('landing_knowledge_id','ID затвердженої посадкової сторінки й маршруту CTA.')],
 'chatgpt','Оберіть логіку кампанії відповідно до фактичної доступності вимірювання. Розділіть підтверджену географію й гіпотези аудиторій. Побудуйте мінімальну структуру та план бюджету, не вигадуючи розмірів аудиторій.',
 'Складіть structure й рівно deliverable_count оголошень у ads. Для Meta задайте аудиторії та ТЗ на креативи; для Google задайте keywords, negatives і тексти відповідно до knowledge-специфікацій. Експерименти міняють одну змінну та мають метрику, умову рішення й обмеження витрат.',
 'PaidMediaOutput',['strategist','ads_specialist','Сума budget.share_percent дорівнює 100','Усі ad_set/ad/experiment посилання існують','Оптимізація відповідає conversion knowledge; налаштування платформи підтверджені'],
 'Структура не фрагментує бюджет, гіпотези перевірювані, вимірювання реалістичне.','ads_manager',['structure','ads'],['Вигаданий CPA чи обсяг аудиторії: claims','Непідтверджені конверсії: лише доступні метрики','Застарілий таргетинг: blocked без platform knowledge'],'P1','ads',30,['structure','ads'])

add('reels_concepts','Сценарії відео, рілсів і промо','Для сценаріїв коротких або довших відео, зйомки й монтажу. Зберігає знайомий ключ reels_concepts; нова версія розширює його на промо-ролики.',[
 enumfield('video_kind',['reel','promo','explainer','testimonial']),F('duration_seconds','number',True,'Число 1-3600.'),listfield('format_knowledge_ids','1-12 ID технічних форматів.'),textfield('production_constraints','Локації, люди, реквізит, час; 1-3000 символів.'),listfield('asset_ids','0-30 активів.',False),textfield('voice_style','Побажання до озвучення; до 1000 символів.',False)],
 'claude_session','Визначте драматургію, гачок і ключову дію глядача. Відберіть знімальні рішення під наявні ресурси. Сформуйте work_items як різні сценарні задуми.',
 'Створіть рівно deliverable_count повних сценаріїв. Розкладіть кожен на таймкоди, відеоряд, озвучення, екранний текст, звук і монтаж. Додайте capture_brief, формати, промпти за потреби й перевірку прав; відеофайл тут не створюється.',
 'ScriptsOutput',['strategist','scriptwriter','Таймкоди послідовні й сумарно дорівнюють тривалості','Текст реально вимовити за відведений час','Усі продуктні твердження й CTA підтверджені'],
 'Гачок працює на задачу, сценарій зрозумілий і здійсненний у заданому продакшні.','video_editor',['scripts','production_checklist'],['Незнімальний задум: constraints check','Чужі треки: rights_checks','Красива ідея без сценарію: обов’язкові shots'],'P1','scripts',10,['scripts','production_checklist'])

add('outdoor_print_pack','Зовнішня реклама й поліграфія','Для білбордів, сітілайтів, флаєрів та А4. Один запуск має один тип носія та конкретну технічну специфікацію постачальника.',[
 enumfield('medium',['billboard','citylight','flyer','a4','other']),textfield('supplier_spec_knowledge_id','ID специфікації друкарні або оператора площини.'),listfield('placement_knowledge_ids','1-30 ID адрес/контексту показу або розповсюдження.'),textfield('cta_route_knowledge_id','ID затвердженого маршруту звернення.'),listfield('mandatory_copy','0-20 обов’язкових рядків; факти лише з knowledge.',False)],
 'claude_session','Визначте одну головну думку й дію після контакту з носієм. Врахуйте відстань, швидкість перегляду або спосіб роздачі. Перевірте техвимоги й затверджений маршрут звернення.',
 'Видайте рівно deliverable_count специфікацій макетів. Додайте композицію, остаточні тексти й параметри друку лише з knowledge постачальника. Для дорожнього носія QR не може бути єдиним способом звернення; додайте план перевірки читабельності й контроль друкованого proof.',
 'PrintOutput',['creative_director','print_designer','Trim/bleed/safe margin/profile/DPI відповідають supplier knowledge','CTA читабельний у контексті показу','Локальна обіцянка відповідає підтвердженому покриттю'],
 'Макет читається в реальних умовах, техвимоги й маршрут відповіді перевірювані.','print',['layouts','supplier_questions'],['Шаблонні 3 мм чи 300 DPI: лише supplier knowledge','QR для водія: не єдиний CTA','Гіперлокальна обіцянка без покриття: blocked'],'P1','layouts',10,['layouts','supplier_questions'])

add('offer_launch','Запуск тарифу або акції','Для узгодженого запуску пропозиції на сайті, у рекламі, SMM та продажах. Формує єдиний пакет меседжів і робіт без автоматичного створення дочірніх плейбуків.',[
 textfield('offer_knowledge_id','ID повних затверджених умов.'),listfield('launch_channels','1-12 каналів.'),textfield('launch_at','ISO 8601 із часовим поясом.'),listfield('readiness_knowledge_ids','1-20 ID стану сайту, продажів і технічної готовності.'),textfield('previous_offer_knowledge_id','ID попередніх умов для заміни.',False)],
 'chatgpt','Перевірте узгодженість умов, географії, строків і обмежень. Визначте, де треба оновити старі повідомлення та що блокує запуск. Сформуйте work_items за каналами з відповідальними ролями.',
 'Підготуйте рівно deliverable_count комунікаційних одиниць для launch_channels. Додайте узгоджені тексти, FAQ продажам і ТЗ на продакшн. Складіть tasks із залежностями, строками, умовами готовності та відкату; не створюйте нових кроків рушія.',
 'LaunchOutput',['strategist','orchestrator','Умови однакові в усіх units і FAQ','tasks утворюють DAG і мають ролі/строки','Є оновлення старих матеріалів і rollback'],
 'Усі канали й продажі готові до узгодженого старту, умови не спотворені.','human',['units','tasks','measurement','readiness_checklist'],['Запуск до готовності сайту: readiness gate','Різні умови в каналах: перевірка offer refs','План видається за виконаний запуск: явний handoff'],'P1','units',20,['units','tasks','measurement','readiness_checklist'])

add('campaign_analysis','Аналіз кампанії та рішення CMO','Для звіту за підтвердженими результатами, порівняння періодів і плану дій. Відсутність даних відображається явно, результати не домислюються.',[
 listfield('dataset_knowledge_ids','1-20 ID затверджених знімків із періодом, валютою й grain.'),textfield('period','Межі аналізованого періоду; 1-300 символів.'),textfield('comparison_period','Межі періоду порівняння.',False),listfield('metric_keys','1-30 назв метрик.'),textfield('decision_question','Яке рішення має підтримати звіт; 1-2000 символів.')],
 'chatgpt','Перевірте свіжість, повноту, зерно, дублікати, валюту та зіставність даних. Визначте, які метрики можна чесно порахувати й порівняти. Запишіть план аналізу та прогалини без припущених конверсій.',
 'Сформуйте рівно deliverable_count висновків findings і пріоритетні actions. Для кожної похідної цифри додайте calculation із формулою, підстановкою, knowledge refs та обмеженнями. За відсутності знаменника поверніть null із причиною; причинні пояснення без доказів класифікуйте як hypotheses.',
 'AnalysisOutput',['performance_analyst','performance_analyst','Формули незалежно перераховані кодом','CTR/CPC/CPA мають коректні знаменники; нуль не підміняє відсутні дані','Періоди, attribution і валюти зіставні'],
 'Розрахунки відтворюються, причинність не перебільшена, дії випливають із висновків.','human',['findings','calculations','actions','data_quality'],['Немає лідів, але є CPA: блокування розрахунку','Змішані періоди/валюти: data_quality','Кореляція названа причиною: hypothesis'],'P2','findings',30,['findings','calculations','actions','data_quality'])

add('competitor_analysis','Конкурентний аналіз','Для зіставлення операторів, пропозицій і комунікацій на визначеній території. Нові веб-знахідки є кандидатами на knowledge, доки власник не підтвердить їх.',[
 listfield('competitors','1-10 ID або назв конкурентів.'),listfield('dimensions','1-10 критеріїв порівняння.'),listfield('geo_knowledge_ids','1-20 ID територій порівняння.'),listfield('source_knowledge_ids','1-30 ID затверджених конкурентних даних із датами.'),enumfield('research_mode',['knowledge_only','candidate_collection'])],
 'chatgpt','Побудуйте матрицю конкурентів і критеріїв. Перевірте, чи зіставні території, умови й дати спостережень. У режимі candidate_collection збирайте доступні публічні джерела окремо; без браузерного доступу не імітуйте дослідження.',
 'Заповніть повну матрицю rows, де невідоме має null і status=unavailable. Дайте рівно deliverable_count findings та пов’язані actions. Нові непогоджені факти збережіть лише в research_candidates і claims_needing_source; вони не є підставою для підтверджених висновків.',
 'CompetitorOutput',['research_analyst','research_analyst','rows дорівнює competitors × dimensions без дублів','verified rows мають knowledge refs і observed_at','Непогоджені web-кандидати відокремлені від фактичної матриці'],
 'Порівняння зіставне, свіже за knowledge-правилами й не підміняє невідоме оцінкою.','human',['rows','findings','actions','research_candidates'],['Ціна без умов і дати: unavailable','Національна пропозиція приписана локальній адресі: geo check','Веб-пошук автоматично став knowledge: заборонено'],'P3','findings',30,['rows','findings','actions','research_candidates'])

add('owned_media_copy','Сайт, email, SMS, PR та сервісні тексти','Для текстів посадкових сторінок, листів, SMS, новин, IVR і FAQ. Один запуск охоплює один вид матеріалу та готує його до людської публікації.',[
 enumfield('copy_kind',['website','landing','email','sms','pr','ivr','faq']),listfield('message_knowledge_ids','1-30 ID фактів і умов повідомлення.'),textfield('destination_knowledge_id','ID затвердженого маршруту CTA.',False),textfield('delivery_spec_knowledge_id','ID техлімітів, вимог згоди/відписки або редакційних правил.'),textfield('publication_at','ISO 8601 із часовим поясом.',False),listfield('mandatory_sections','0-30 обов’язкових блоків.',False)],
 'claude_session','Визначте одну головну дію читача або слухача та структуру матеріалу. Перевірте, які факти, цитати, дати й вимоги каналу підтверджені. Для сервісних повідомлень відокремте підтверджений стан від прогнозів.',
 'Напишіть рівно deliverable_count одиниць обраного copy_kind. Додайте відповідні subject/preheader, секції, метадані й перевірки доставки; зайві поля заповніть null або порожнім масивом. У SMS врахуйте кодування й ліміт із knowledge, у PR не вигадуйте цитат, у IVR не вигадуйте строків відновлення.',
 'OwnedCopyOutput',['strategist','copywriter','Тип усіх units дорівнює copy_kind','Канал-специфічні обмеження перевірені кодом або людиною','Цитати, обіцянки, CTA й сервісні строки підтверджені'],
 'Структура відповідає каналу, головна дія зрозуміла, текст готовий до передачі редактору.','human',['units','delivery_checklist'],['Вигадана цитата: source gate','SMS дорожчає через довжину: delivery check','Непідтверджений час відновлення: виключити або blocked'],'P2','units',30,['units','delivery_checklist'])

# Формальні схеми полів брифу. Базові references - лише натхнення, не factual knowledge.
field_enums={
 'content_kind':['post','stories','carousel','short_video'], 'idea_kind':['campaign','activation','hook','naming','mechanic'],
 'platform':['meta','google'],'video_kind':['reel','promo','explainer','testimonial'],
 'medium':['billboard','citylight','flyer','a4','other'], 'research_mode':['knowledge_only','candidate_collection'],
 'copy_kind':['website','landing','email','sms','pr','ivr','faq']}
list_limits={'channels':(1,5),'pillars':(1,12),'capacity_knowledge_ids':(1,10),'events_knowledge_ids':(0,30),'plan_item_ids':(0,30),'available_asset_ids':(0,30),'platform_spec_knowledge_ids':(1,20),'placements':(1,12),'format_knowledge_ids':(1,12),'asset_ids':(0,30),'required_copy':(0,20),'campaign_channels':(1,12),'mandatory_asset_ids':(0,30),'reference_notes':(0,20),'rejected_ideas':(0,30),'geo_knowledge_ids':(1,30),'placement_knowledge_ids':(1,30),'mandatory_copy':(0,20),'launch_channels':(1,12),'readiness_knowledge_ids':(1,20),'dataset_knowledge_ids':(1,20),'metric_keys':(1,30),'competitors':(1,10),'dimensions':(1,10),'source_knowledge_ids':(1,30),'message_knowledge_ids':(1,30),'mandatory_sections':(0,30)}
BRIEFS={}
for p,meta in zip(PLAYBOOKS,META):
 props=dict(title=S(200),objective=S(3000),audience=S(2000),channel=S(120),deliverable_count=I(1,meta['deliverable_count_max']),deadline={**S(80),'format':'date-time'},acceptance_criteria=A(S(1500),1,20),references=A(S(2048),0,20))
 req=list(props)
 for f in p['brief_fields']:
  k=f['key']; t=f['type']
  if t=='enum': sch=E(*field_enums[k])
  elif t=='number': sch=I(6,12) if k=='candidate_count' else N(1,3600)
  elif t=='list':
   low,hi=list_limits[k]; sch=A(S(1000),low,hi); sch['uniqueItems']=True
  else:
   sch=S(3000)
   if k in ['period_start','period_end']: sch={**S(10),'format':'date'}
   if k in ['launch_at','publication_at']: sch={**S(80),'format':'date-time'}
  props[k]=sch
  if f['required']: req.append(k)
 BRIEFS[p['playbook_key']]={'type':'object','additionalProperties':False,'properties':props,'required':req}

SCHEMAS={'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://ai-office.invalid/schemas.json','$defs':DEFS}
(ROOT/'schemas.json').write_text(json.dumps(SCHEMAS,ensure_ascii=False,indent=2))
(ROOT/'brief-schemas.json').write_text(json.dumps({'$schema':SCHEMAS['$schema'],'$defs':BRIEFS},ensure_ascii=False,indent=2))
(ROOT/'registry.json').write_text(json.dumps({'library_version':'2026.10.19-v1','playbooks':META},ensure_ascii=False,indent=2))
(ROOT/'playbooks.yaml').write_text(yaml.safe_dump_all(PLAYBOOKS,allow_unicode=True,sort_keys=False,width=120))

if __name__=='__main__': print(json.dumps({'playbooks':len(PLAYBOOKS),'schemas':len(DEFS),'root':str(ROOT)},ensure_ascii=False))
