import PDFParser from 'pdf2json';
import type { Page } from 'pdf2json';
import { csvRows, zipEntries } from './formats';
export type DocumentBlock = { text: string; kind: 'paragraph' | 'heading' | 'list' | 'table-row' | 'blank'; page?: number; column?: number; x?: number; y?: number; path?: string; links?: string[] };
export type ParsedDocument = { format: string; blocks: DocumentBlock[]; tables: { name: string; rows: Record<string, string>[] }[]; warnings: string[] };
export function textDocument(text: string, format = 'txt'): ParsedDocument {
 return {format, blocks:text.normalize('NFKC').split(/\r?\n/).map(text=>({text:text.replace(/^\s*[-#*\u2022]+\s*/, '').trim(),kind:!text.trim()?'blank':/^\s*#/.test(text)?'heading':/^\s*[-*\u2022]\s/.test(text)?'list':'paragraph'})),tables:[],warnings:[]};
}
// Bounded, non-resolving XML tree. No DTD, entities, scripts or external IO.
type Node = {name:string; attrs:Record<string,string>; children:Node[]; value:string};
const entity = (s:string) => s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v:string)=> { if(v[0]==='#'){const n=v[1]?.toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1)); if(n<1||n>0x10ffff||n>=0xd800&&n<=0xdfff)throw new Error('INVALID_XML');return String.fromCodePoint(n);} return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[v.toLowerCase()]??''; });
function xmlTree(xml:string):Node {
 if(xml.length>5_000_000 || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml))throw new Error('INVALID_XML');
 const root:Node={name:'root',attrs:{},children:[],value:''};const stack=[root];let offset=0,count=0;
 const tokens=/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<\/?[\w:.-]+(?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>|[^<]+/g;
 for(const match of xml.matchAll(tokens)) {if(match.index!==offset)throw new Error('INVALID_XML');offset+=match[0].length;const t=match[0];if(t.startsWith('<?')||t.startsWith('<!--'))continue;
  if(t.startsWith('</')){const name=t.slice(2,-1).trim();if(stack.length<2||stack.pop()!.name!==name)throw new Error('INVALID_XML');}
  else if(t.startsWith('<')){if(++count>50000||stack.length>100)throw new Error('XML_LIMIT'); const name=/^<([\w:.-]+)/.exec(t)![1]!; const attrs:Record<string,string>={};for(const a of t.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))attrs[a[1]!.split(':').at(-1)!]=entity(a[2]??a[3]??'');const node={name,attrs,children:[],value:''};stack.at(-1)!.children.push(node);if(!t.endsWith('/>'))stack.push(node);}
  else {const node:Node={name:'#text',attrs:{},children:[],value:entity(t)};stack.at(-1)!.children.push(node);}
 }
 if(offset!==xml.length||stack.length!==1||root.children.filter(n=>n.name!=='#text').length!==1)throw new Error('INVALID_XML');return root;
}
const local=(n:Node)=>n.name.split(':').at(-1);
const all=(n:Node,name:string):Node[]=>n.children.flatMap(c=>[...(local(c)===name?[c]:[]),...all(c,name)]);
const textOf=(n:Node):string=>local(n)==='t'?n.children.map(c=>c.value).join(''):local(n)==='tab'?'\t':local(n)==='br'?'\n':n.children.map(textOf).join('');
function docx(bytes:Buffer):DocumentBlock[] {
 const entries=zipEntries(bytes);const raw=entries.get('word/document.xml');if(!raw)throw new Error('INVALID_DOCX');const tree=xmlTree(raw.toString('utf8'));const body=all(tree,'body')[0];if(!body)throw new Error('INVALID_DOCX');
 const rels=entries.get('word/_rels/document.xml.rels');const links=new Map(rels?all(xmlTree(rels.toString('utf8')),'Relationship').map(r=>[r.attrs.Id!,r.attrs.Target!]):[]);
 const styles=entries.get('word/styles.xml');const headings=new Set(styles?all(xmlTree(styles.toString('utf8')),'style').filter(s=>/heading/i.test(all(s,'name')[0]?.attrs.val??'')).map(s=>s.attrs.styleId):[]);
 const blocks:DocumentBlock[]=[];
 body.children.forEach((n,i)=>{if(local(n)==='p'){const style=all(n,'pStyle')[0]?.attrs.val;blocks.push({text:textOf(n).trim(),kind:all(n,'numPr').length?'list':style&&(/heading|title/i.test(style)||headings.has(style))?'heading':'paragraph',path:`paragraph:${i+1}`,links:all(n,'hyperlink').map(h=>links.get(h.attrs.id??'')??'').filter(u=>/^https?:\/\//i.test(u))});}
 else if(local(n)==='tbl')all(n,'tr').forEach((row,j)=>blocks.push({text:row.children.filter(c=>local(c)==='tc').map(c=>all(c,'p').map(textOf).join(' ')).join(' | '),kind:'table-row',path:`table:${i+1}/row:${j+1}`}));});
 return blocks;
}
export function pdfBlocks(pages:Page[]):{blocks:DocumentBlock[];warnings:string[]} {
 const blocks:DocumentBlock[]=[];const warnings:string[]=[];
 pages.forEach((page,index)=>{
  if(page.Texts.length>15000)throw new Error('PDF_LIMIT');
  const text=page.Texts.map(t=>({x:t.x,y:t.y,w:t.w/16,text:t.R.map(r=>decodeURIComponent(r.T)).join('')})).filter(t=>t.text.trim());
  const split=page.Width*.5;const left=text.filter(t=>t.x<split);const right=text.filter(t=>t.x>=split);
  const columns=left.length>=3&&right.length>=3&&left.filter(t=>t.x+t.w<split-.3).length/left.length>.8;
  if(columns)warnings.push(`Page ${index+1}: two-column reading order recovered; review section association.`);
  const groups=columns?[left,right]:[text];groups.forEach((items,column)=>{
   items.sort((a,b)=>a.y-b.y||a.x-b.x);const rows:typeof items[]=[];
   for(const t of items){const row=rows.at(-1);if(row&&Math.abs(row[0]!.y-t.y)<.25)row.push(t);else rows.push([t]);}
   rows.forEach(row=>{row.sort((a,b)=>a.x-b.x);blocks.push({text:row.map(t=>t.text).join(' ').trim(),kind:'paragraph',page:index+1,column:column+1,x:row[0]!.x,y:row[0]!.y});});
  });
 });return {blocks,warnings};
}
export async function extractDocument(format:string,bytes:Buffer):Promise<ParsedDocument> {
 if(!bytes.length||bytes.length>5_000_000)throw new Error('FILE_LIMIT');let doc:ParsedDocument={format,blocks:[],tables:[],warnings:[]};
 if(format==='pdf'){
  if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('INVALID_PDF');
  const layout=await new Promise<ReturnType<typeof pdfBlocks>>((resolve,reject)=>{const parser=new PDFParser(null,false);const timer=setTimeout(()=>{parser.destroy();reject(new Error('PDF_TIMEOUT'));},10000);parser.on('pdfParser_dataError',()=>{clearTimeout(timer);reject(new Error('PDF_PARSE_FAILED'));});parser.on('pdfParser_dataReady',data=>{clearTimeout(timer);try{if(data.Pages.length>100)throw new Error('PDF_LIMIT');resolve(pdfBlocks(data.Pages));}catch{reject(new Error('PDF_PARSE_FAILED'));}finally{parser.destroy();}});const exact=Buffer.alloc(bytes.length);bytes.copy(exact);parser.parseBuffer(exact,0);});doc={...doc,...layout};
 }else if(format==='docx')doc.blocks=docx(bytes);
 else if(format==='zip'||format==='csv'){
  const entries=format==='zip'?zipEntries(bytes):new Map([['archive.csv',bytes]]);
  doc.tables=[...entries].filter(([name])=>/\.csv$/i.test(name)).map(([name,data])=>({name,rows:csvRows(data.toString('utf8'))}));
  if(!doc.tables.length)throw new Error('NO_LINKEDIN_CSV');
 }else if(['txt','md','markdown','json'].includes(format))doc=textDocument(bytes.toString('utf8').replace(/^\uFEFF/,''),format);
 else throw new Error('UNSUPPORTED_FILE');
 const text=[...doc.blocks.map(b=>b.text),...doc.tables.map(t=>JSON.stringify(t.rows))].join('\n');
 if(!text.trim()||text.length>200000||text.includes('\0'))throw new Error('TEXT_LIMIT_OR_SCANNED_PDF');return doc;
}
export async function extractFileText(format:string,bytes:Buffer):Promise<string>{const doc=await extractDocument(format,bytes);return doc.tables.length?JSON.stringify(doc.tables):doc.blocks.map(b=>b.text).join('\n')+(format==='docx'?'\n':'');}
