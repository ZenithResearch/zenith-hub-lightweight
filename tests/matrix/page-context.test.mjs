import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePageContext} from '../../src/lib/setup/page-context.ts';
test('Matrix conversations are excluded from the MVP Hermes context even when the body is the capture root',()=>{
 const text=value=>({nodeType:3,textContent:value});
 const element=(tag,children=[],id='')=>({nodeType:1,tagName:tag,childNodes:children,matches:selector=>id&&selector.split(',').map(s=>s.trim()).includes('#'+id),hasAttribute:()=>false,getAttribute:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({width:100,height:20})});
 const body=element('BODY',[element('P',[text('Public Hub instructions')]),element('SECTION',[text('Private Matrix message')],'zenith-matrix-chat')]);
 const doc={body,title:'Hub',location:{pathname:'/hub'},querySelectorAll:()=>[],querySelector:()=>null,defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1',contentVisibility:'visible',overflow:'visible',clipPath:'none'})}};
 const context=capturePageContext(doc);assert.match(context.text,/Public Hub instructions/);assert.doesNotMatch(context.text,/Private Matrix message/);
});
