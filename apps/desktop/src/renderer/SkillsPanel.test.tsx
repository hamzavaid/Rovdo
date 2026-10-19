import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SkillsPanel } from './SkillsPanel';
import { sampleCandidate } from '../../../../tests/fixtures/ranking-v2';
it('shows real skills as searchable grouped chips without expanding every editor', () => {
  const html = renderToStaticMarkup(<SkillsPanel profile={sampleCandidate()} onUpdate={() => {}} onAdd={() => {}} />);
  expect(html).toContain('Search your skills'); expect(html).toContain('Programming'); expect(html).toContain('TypeScript');
  expect(html).toContain('Edit TypeScript skill'); expect(html).not.toContain('Source evidence');
  expect(html).not.toContain('Verilog');
});

it('shows one chip for a canonical skill represented in both legacy and structured data',()=>{const profile=sampleCandidate();profile.facts.push({id:'legacy-ts',field:'skill',value:'TS',verified:true,source:{kind:'user',reference:'Original assertion',capturedAt:'2026-10-19T00:00:00.000Z'}});const html=renderToStaticMarkup(<SkillsPanel profile={profile} onUpdate={()=>{}} onAdd={()=>{}}/>);expect((html.match(/Edit TypeScript skill/g)??[]).length).toBe(1);});
