/** Compile immutable repository packages into an importable, hash-addressed registry. */
import { readdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const registry:Record<string,{key:string;version:number;sha256:string;text:string}>={};
for(const v of (await readdir('skills')).filter(s=>/^v\d+$/.test(s)).sort()) {
  for(const key of (await readdir(`skills/${v}`)).sort()) {
    const root=`skills/${v}/${key}`;
    const files=['SKILL.md',...(await readdir(`${root}/references`)).sort().map(f=>`references/${f}`)];
    const text=(await Promise.all(files.map(async f=>`## ${f}\n${await readFile(`${root}/${f}`,'utf8')}`))).join('\n\n');
    const version=Number(v.slice(1));
    registry[`${key}@${version}`]={key,version,sha256:createHash('sha256').update(text).digest('hex'),text};
  }
}
await writeFile('src/lib/orchestrator/skill-packages.json',JSON.stringify(registry,null,2)+'\n');
console.log(`Compiled ${Object.keys(registry).length} skill packages`);
