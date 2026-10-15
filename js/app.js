/* Bullseye Board: route health for each branch (settings in branches.json)
   Viewers load data/board.json. Open the site with ?admin to upload reports and export a new board.json. */
(() => {
let ADMIN=new URLSearchParams(location.search).has('admin'); // update mode only works on the admin branch's page (see branches.json)
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- branch setup ---------- */
// Set per page from branches.json: report branch code and Employment List location
let BRANCH='TUC', LOCATION='Tucson';
const FIELD_DEPT=/^operations,\s*field/i;
const NON_PERSON=/open tech|subcontract|name not found|administrator|employee,\s*inactive|unassigned|^code\|/i;
// First month shown in the month picker (earlier months still feed year-to-date branch numbers)
const START_MONTH='2026-09';
// Per-customer cancel lists are kept from the month before START_MONTH on; older history keeps totals only
const LIST_FROM=(()=>{ const [y,m]=START_MONTH.split('-').map(Number); return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`; })();
// Monthly targets: complete 98.5% of stops; cancel % no higher than 1.7% (gross dollars: cancelled annual $ ÷ active annual $,
// the company Net Gain report's Cancellation %); void % no higher than 1.5% of total stops
const TARGET={completion:98.5,cancel:1.7,void:1.5};
// Tech ranking: points out of 160 each month. Each piece ranks the tech against the rest of the team (best = full points).
// Route completion 80 (50%): completion rate on their own stops 53 + workload 27, their share of the branch's stops.
// Workload is behind the scenes only (never shown) so a small route can't win on completion alone.
// Cancels 40 (25%), voids 29 (18%), net gain 11 (7%).
const SCORE_MAX=160;
const SCORE_WEIGHTS={completion:53,workload:27,cancel:40,void:29,net:11};
const SCORE_GROUPS=[['Route completion',['completion','workload']],['Cancel %',['cancel']],['Void %',['void']],['Net gain',['net']]];
// PestPac name changes: old name -> current name (lowercase "last|first")
let ALIASES={}; // per branch, from branches.json
const DISTRICT_CODE='DSW'; // the district board's "branch code" (district/ in the repo)
// People whose numbers always go to the main branch total, never ranked
let FORCE_MAIN=[]; // per branch, from branches.json
const AGE=['Under 1 yr','1–2 yrs','2–3 yrs','3–5 yrs','5–10 yrs','10+ yrs'];
const ageIdx=y=>y==null?null:y<1?0:y<2?1:y<3?2:y<5?3:y<10?4:5;
const REASONS={CLOSEMOVE:'Moved',FINANCIAL:'Financial',SERVICE:'Service issue','PRICE INCR':'Price increase','NO NEED':'No longer needed',COMPETITOR:'Went to competitor',EXPIRED:'Expired',OFFICEADMN:'Office / admin','NO CONTACT':'Couldn’t reach',COLLECTION:'Collections','PM CHANGE':'Property manager change',SALES:'Sales issue',DECEASED:'Deceased','NAT DISAST':'Natural disaster'};
const NICK={bill:'william',will:'william',billy:'william',bob:'robert',rob:'robert',rick:'richard',rich:'richard',jim:'james',jimmy:'james',joe:'joseph',mike:'michael',tony:'anthony',dave:'david',dan:'daniel',tom:'thomas',ben:'benjamin',sam:'samuel',chris:'christopher',alex:'alexander',matt:'matthew',nick:'nicholas',steve:'stephen',greg:'gregory',andy:'andrew',josh:'joshua',jon:'jonathan',jake:'jacob',ken:'kenneth',kenny:'kenneth'};
const SORTS={
  route:[
    {key:'health',label:'Points',dir:-1},
    {key:'cancelPct',label:'Cancel %',dir:1},
    {key:'cancelRate',label:'Cancels per 100 services',dir:1},
    {key:'cancelShare',label:'Share of cancels',dir:1},
    {key:'voidN',label:'Voids',dir:1},
    {key:'comp',label:'Completion %',dir:-1},
    
    {key:'netGain',label:'Net gain',dir:-1},
    {key:'adds',label:'Recurring adds',dir:-1},
  ],
  sales:[
    {key:'proj',label:'Overall',dir:-1},
    {key:'score',label:'Sales score',dir:-1},
    {key:'goalPct',label:'Total % of budget',dir:-1},
    {key:'recPct',label:'Recurring % of budget',dir:-1},
    {key:'otPct',label:'One-time & initial % of budget',dir:-1},
    {key:'recAmt',label:'Recurring',dir:-1},
    {key:'otAll',label:'One-time & initial $',dir:-1},
  ],
};
const PCT=['workload','comp','cancelPct','cancelRate','cancelShare','voidRate','pace','goalPct','recPct','otPct'], MONEY=['netGainVal','proj','overall','recVal','otRev','otAll','prod','leadVal','stopsProd'];

const state={months:{},bases:{},locnames:{},roster:{employees:null,codes:{},termedSeen:{},show:{}},month:null,mode:'month',sec:'route',
  sort:{route:'health',sales:'proj'},cx:{view:'pct',who:''},db:null,canEdit:null,local:false,pending:[],arm:null};

/* ---------- helpers ---------- */
const pad=n=>String(n).padStart(2,'0');
function toDate(v){
  if(Object.prototype.toString.call(v)==='[object Date]') return isNaN(v.getTime())?null:v;
  if(typeof v==='number'&&v>20000&&v<80000) return new Date(1899,11,30+Math.floor(v));
  if(typeof v==='string'&&v.trim()){ const d=new Date(v); return isNaN(d)?null:d; }
  return null;
}
// Some exports format ID columns as dates; turn those back into the original number
function idStr(v){ if(Object.prototype.toString.call(v)==='[object Date]'&&!isNaN(v.getTime())) return String(Math.round((v.getTime()-new Date(1899,11,30).getTime())/864e5)); return String(v??'').trim().replace(/\.0+$/,''); }
function ym(d){ const x=new Date(d.getTime()+6*3600e3); return x.getFullYear()+'-'+pad(x.getMonth()+1); }
function ymd(d){ const x=new Date(d.getTime()+6*3600e3); return x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate()); }
function monthName(m,short){ const [y,mo]=m.split('-').map(Number); return new Date(y,mo-1,15).toLocaleDateString(undefined,short?{month:'short'}:{month:'long',year:'numeric'}); }
function num(v){ if(typeof v==='number') return isFinite(v)?v:null; if(v==null) return null; const s=String(v).replace(/[,$\s]/g,''); if(!s) return null; const f=parseFloat(s); return isNaN(f)?null:f; }
function pct1(v){ return v==null?'—':(Math.abs(v)<0.05?0:v).toFixed(1)+'%'; }
// One decimal, but two when rounding would hide which side of a goal the number is on (1.54% vs 1.5%)
function pctG(v,goal){ if(v==null) return '—'; return (Math.abs(v-goal)<0.05&&Math.abs(v-goal)>1e-9)||(v>0&&v<1)?v.toFixed(2)+'%':pct1(v); } // small values keep two decimals, like the company report (0.18%)
function pct(v){ return v==null?'—':(Math.abs(v)<10?v.toFixed(1):Math.round(v))+'%'; }
function money(v){ if(v==null) return '—'; const a=Math.abs(v); return (v<0?'-':'')+'$'+(a>=1e6?(a/1e6).toFixed(2)+'M':a>=100000?Math.round(a/1000)+'k':a>=10000?(a/1000).toFixed(1)+'k':Math.round(a).toLocaleString()); }
function fmt(k,v){ if(v==null) return '—'; if(k==='netGainVal') return (v>0?'+':v<0?'−':'')+money(Math.abs(v)); if(k==='recAmt') return money(v); if(PCT.includes(k)) return pct1(v); if(MONEY.includes(k)) return money(v); if(k==='netGain') return (v>0?'+':'')+Math.round(v).toLocaleString(); return Math.round(v).toLocaleString(); }
const tc=s=>String(s||'').toLowerCase().replace(/(^|[\s\-'])([a-z])/g,(m,a,b)=>a+b.toUpperCase());
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z]/g,'');
function firstMatch(a,b){ a=norm(a); b=norm(b); if(!a||!b) return false; if(a===b) return true; if((NICK[a]||a)===(NICK[b]||b)) return true; return a[0]===b[0]; }
function parseName(raw){
  let s=String(raw??'').trim().replace(/\s+/g,' '); if(!s) return null;
  let last,first,termed=null;
  if(s.includes(',')){ const i=s.indexOf(','); last=s.slice(0,i).trim(); first=s.slice(i+1).trim(); }
  else { const w=s.split(' '); first=w.length>1?w[0]:''; last=w.length>1?w.slice(1).join(' '):w[0]; }
  const dm=last.match(/\s+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s*$/); if(dm){ termed=dm[1]; last=last.slice(0,dm.index).trim(); }
  return {last,first,termed,key:(last+'|'+first).toLowerCase()};
}
function ordinal(n){ const s=['th','st','nd','rd'],v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }
function band(p){ return p==null?'c-none':p>=0.67?'c-good':p>=0.34?'c-mid':'c-low'; }
function avg(a){ const v=a.filter(x=>x!=null); return v.length?v.reduce((s,x)=>s+x,0)/v.length:null; }
// Company holidays (2026 holiday calendar). The floating holiday is personal, so it isn't on the list.
// More dates can be added in update mode under Holidays; they're saved in board.json.
const COMPANY_HOLIDAYS=['2026-01-01','2026-05-25','2026-07-03','2026-09-07','2026-11-26','2026-11-27','2026-12-24','2026-12-25'];
function holidaySet(){ return new Set([...COMPANY_HOLIDAYS,...(state.roster?.holidays||[])]); }
function isWorkday(dt,hol){ const wd=dt.getDay(); return wd>0&&wd<6&&!hol.has(dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate())); }
// Pace = workdays done through the data date ÷ all workdays in the month. Workdays are Mon–Fri minus company holidays.
// The company's working-day count for a month, from the FY budget plan (e.g. October 2026 = 23); null if no plan is loaded
function planWorkdays(month){ return state.roster?.plans?.[month.slice(0,4)]?.workdays?.[month]||null; }
function workdayShare(month,asOf){
  const [y,m]=month.split('-').map(Number), last=new Date(y,m,0).getDate(), hol=holidaySet();
  const cut=asOf?new Date(asOf+'T12:00:00'):new Date();
  let total=0,done=0;
  for(let d=1;d<=last;d++){ const dt=new Date(y,m-1,d,12); if(isWorkday(dt,hol)){ total++; if(dt<=cut) done++; } }
  const days=planWorkdays(month)||total; // match the company's working-day counts when the budget plan has them
  return days?Math.min(Math.max(done,1)/days,1):1;
}

/* ---------- who is who ---------- */
function resolveKey(key){
  key=ALIASES[key]||key;
  const [last,first]=key.split('|');
  const r={status:'board',display:first?tc(first)+' '+tc(last):tc(last),emp:null};
  if(key.startsWith('code|')){ r.status='other'; r.display='Tech code '+first.toUpperCase(); }
  else if(NON_PERSON.test(last+', '+first)||NON_PERSON.test(first+' '+last)) r.status='other';
  else if(state.roster.employees){
    const e=state.roster.employees.find(e=>norm(e.last)===norm(last)&&firstMatch(e.first,first));
    if(!e) r.status='termed';
    else { r.emp=e; r.display=e.first+' '+e.last; r.status=FIELD_DEPT.test(e.dept)?'board':'staff'; }
  } else if(state.roster.termedSeen?.[key]) r.status='termed';
  r.id=r.emp?'e'+r.emp.id:'k'+key;
  r.key=key;
  const ov=state.roster.show?.[r.id];
  if(ov&&r.status!=='other') r.status=ov==='board'?'board':(r.status==='board'?'staff':r.status);
  if(FORCE_MAIN.includes(key)||(r.emp&&FORCE_MAIN.includes((r.emp.last+'|'+r.emp.first).toLowerCase()))) r.status='main';
  return r;
}

/* ---------- customer list (active base) ---------- */
const ABBR=[[/\bNORTH\b/g,'N'],[/\bSOUTH\b/g,'S'],[/\bEAST\b/g,'E'],[/\bWEST\b/g,'W'],[/\bSTREET\b/g,'ST'],[/\bAVENUE\b/g,'AVE'],[/\bROAD\b/g,'RD'],[/\bDRIVE\b/g,'DR'],[/\bPLACE\b/g,'PL'],[/\bLANE\b/g,'LN'],[/\bCOURT\b/g,'CT'],[/\bCIRCLE\b/g,'CIR'],[/\bBOULEVARD\b/g,'BLVD'],[/\bTRAIL\b/g,'TRL'],[/\bPARKWAY\b/g,'PKWY'],[/\bHIGHWAY\b/g,'HWY'],[/\bSUITE\b/g,'STE'],[/\bAPARTMENT\b|\bAPT\b|\bUNIT\b|#/g,'UNIT'],[/\bCALLE\b/g,'CALLE']];
function normAddr(a1,a2,zip){
  let s=(String(a1||'')+' '+String(a2||'')).toUpperCase().replace(/[.,]/g,' ');
  for(const [re,v] of ABBR) s=s.replace(re,v);
  s=s.replace(/\bUNIT\s+/g,'UNIT ').replace(/\s+/g,' ').trim();
  const z=String(zip||'').replace(/\D/g,'').slice(0,5);
  return s?s+'|'+z:'';
}
const nameTok=s=>String(s||'').toLowerCase().replace(/[^a-z ]/g,' ').split(' ').filter(w=>w.length>=4);
function namesCompatible(a,b){ const A=nameTok(a),B=nameTok(b); if(!A.length||!B.length) return true; return A.some(w=>B.includes(w)); }
function parseCustomerList(text,file){
  if(!/Service Setup List/.test(text.slice(0,3000))) return null;
  const lines=text.split(/\r?\n/);
  const hi=lines.findIndex(l=>l.startsWith('Location\t')&&l.includes('\tService\t'));
  // It is a Service Setup List; make sure it was run with the detailed column layout the board needs
  const need=['Location','Service','Tech 1','Start Date','Status','Location Status','Address','Zip code','Class'];
  const have=hi<0?[]:lines[hi].split('\t');
  const missing=need.filter(n=>!have.includes(n));
  // Annual value: use the Annual column when the export has it; otherwise estimate it from price × visits per year
  if(!have.includes('Annual')&&!(have.includes('Total')&&have.includes('Frequency'))) missing.push('Annual (or Total and Frequency)');
  if(hi<0||missing.length){ const e=new Error(`This is a Service Setup List, but it was exported with a shorter column layout. It’s missing: ${missing.join(', ')}. Run it again with the detailed column layout (Address, Status, Location Status, Class, Frequency and Total or Annual).`); e.userFacing=true; throw e; }
  const hdr=lines[hi], h=hdr.split('\t'), ix=n=>h.indexOf(n);
  const I={cdate:ix('Cancel Date'),loc:ix('Location'),name:ix('Company/Name'),a1:ix('Address'),a2:ix('Address 2'),zip:ix('Zip code'),lt:ix('Location Type'),ls:ix('Location Status'),br:ix('Branch'),svc:ix('Service'),cls:ix('Class'),tech:ix('Tech 1'),st:ix('Status'),start:ix('Start Date'),annual:ix('Annual'),total:ix('Total'),freq:ix('Frequency')};
  const VISITS={'WEEKLY':52,'2X WEEK':104,'BIWEEKLY':26,'2X MONTH':24,'MONTHLY':12,'BIMONTHLY':6,'QUARTERLY':4,'TRIANNUAL':3,'2X YEAR':2,'ANNUAL':1};
  const estAnnual=I.annual<0; let unknownFreq=0;
  const annualOf=f=>{ if(!estAnnual) return num(f[I.annual])||0; const v=VISITS[String(f[I.freq]||'').trim().toUpperCase()]; if(v==null){ unknownFreq++; return 0; } return (num(f[I.total])||0)*v; };
  // Without a Branch column, use the branch the report was filtered to ("Branch: [PMD]") so it lands on the right board
  if(I.br<0){ const fb=(lines.slice(0,hi).find(l=>/^Branch:\t/.test(l))||'').match(/\[([A-Za-z]{2,4})\]/); if(fb&&fb[1].toUpperCase()!==BRANCH) return {type:'base',file:file.name,base:{branch:{setups:0}},summary:''}; }
  const sd=(lines.find(l=>/^System Date:/.test(l))||'').split('\t')[1]||'';
  const asOfD=toDate(sd.replace(/\//g,'-')+'T12:00:00')||new Date();
  const asOf=ymd(asOfD);
  let rows=0,bad=0,inactive=0,otherBranch=0; const names={}; const yr=asOf.slice(0,4);
  const cust=[], byLoc={}, byAddr={}, lines2={};
  const dupSvc=[];
  for(let i=hi+1;i<lines.length;i++){
    const l=lines[i]; if(l===hdr) continue;
    const f=l.split('\t'); if(f.length<h.length-6||!/^\d+$/.test(f[I.loc]||'')) continue;
    rows++;
    const st=f[I.st]; if(st!=='Active'&&st!=='Inactive'){ bad++; continue; }
    if(st==='Active'&&f[I.ls]==='Active') names[f[I.loc]]=String(f[I.name]||'').trim();
    else if(String(f[I.cdate]||'').slice(0,4)>=yr&&!names[f[I.loc]]) names[f[I.loc]]=String(f[I.name]||'').trim();
    if(st!=='Active'||f[I.ls]!=='Active'){ inactive++; continue; }
    if(I.br>=0&&f[I.br]&&f[I.br].toUpperCase()!==BRANCH){ otherBranch++; continue; }
    const loc=f[I.loc], name=f[I.name], ak=normAddr(f[I.a1],f[I.a2],f[I.zip]), com=f[I.lt]==='C';
    let c=byLoc[loc];
    if(!c&&ak){ c=(byAddr[ak]||[]).find(x=>!com||!x.com||namesCompatible(x.name,name)); }
    if(!c){ c={id:cust.length,locs:new Set(),name,com,start:null}; cust.push(c); if(ak) (byAddr[ak]||(byAddr[ak]=[])).push(c); }
    c.locs.add(loc); byLoc[loc]=c;
    const svc=String(f[I.svc]||'').trim().toUpperCase(), key=c.id+'|'+svc;
    const annual=annualOf(f), sdt=toDate(String(f[I.start]||'').replace(/\//g,'-')+'T12:00:00');
    const yrs=sdt?(asOfD-sdt)/(365.25*864e5):null;
    if(lines2[key]){ lines2[key].annual+=annual; lines2[key].dups++; continue; }
    lines2[key]={c,svc,cls:String(f[I.cls]||'').trim().toUpperCase(),tech:String(f[I.tech]||'').trim().toUpperCase(),annual,yrs,dups:0};
  }
  const B={customers:0,setups:0,annual:0,age:[0,0,0,0,0,0],ageAnnual:[0,0,0,0,0,0],cls:{},res:0,com:0};
  const T={}, used=new Set(), techCust={};
  for(const s of Object.values(lines2)){
    B.setups++; B.annual+=s.annual; used.add(s.c.id);
    const ai=ageIdx(s.yrs); if(ai!=null){ B.age[ai]++; B.ageAnnual[ai]+=s.annual; }
    const k=B.cls[s.cls]||(B.cls[s.cls]={setups:0,annual:0}); k.setups++; k.annual+=s.annual;
    const code=s.tech||'UNASSIGNED', t=T[code]||(T[code]={customers:0,setups:0,annual:0,age:[0,0,0,0,0,0]});
    t.setups++; t.annual+=s.annual; if(ai!=null) t.age[ai]++;
    const tc=techCust[code]||(techCust[code]=new Set()); if(!tc.has(s.c.id)){ tc.add(s.c.id); t.customers++; }
    if(s.dups) dupSvc.push({locs:[...s.c.locs].join(', '),svc:s.svc,extra:s.dups});
  }
  for(const c of cust){ if(!used.has(c.id)) continue; B.customers++; if(c.com) B.com++; else B.res++; }
  const merged=cust.filter(c=>used.has(c.id)&&c.locs.size>1).map(c=>[...c.locs].join(', '));
  B.annual=Math.round(B.annual*100)/100;
  for(const t of Object.values(T)) t.annual=Math.round(t.annual*100)/100;
  const activeRows=rows-bad-inactive-otherBranch;
  return {type:'base',file:file.name,asOf,codes:{},termedSeen:{},locnames:names,
    base:{asOf,file:file.name,branch:B,tech:T,checks:{rows,bad,inactive,otherBranch,activeRows,dupSvc:dupSvc.length,dupSvcRows:dupSvc.reduce((a,d)=>a+d.extra,0),mergedLocs:merged.length,dupList:dupSvc.slice(0,150),mergedList:merged.slice(0,150)}},
    summary:`${estAnnual?`No Annual column, so annual value is estimated from price × visits per year (within about 2% on Tucson’s data${unknownFreq?`; ${unknownFreq} setups with an unknown frequency count as $0`:''}). `:''}${rows.toLocaleString()} setups read. ${inactive.toLocaleString()} inactive or cancelled removed${bad?`, ${bad} unreadable rows skipped`:''}. ${activeRows.toLocaleString()} active setups → ${B.setups.toLocaleString()} after removing ${dupSvc.reduce((a,d)=>a+d.extra,0)} repeated services, and ${merged.length} customers had more than one location number at the same address. Active base: ${B.customers.toLocaleString()} customers, ${B.setups.toLocaleString()} service setups, ${money(B.annual)} a year, as of ${asOf}.`};
}
function latestBase(){ const ds=Object.keys(state.bases||{}).sort(); return ds.length?state.bases[ds[ds.length-1]]:null; }
// Branch base at the start of month m: today's base rolled back with recurring adds and cancels since then
function baseAtStart(m,base){
  if(!base) return null; const snapM=base.asOf.slice(0,7);
  let v=base.branch.setups;
  for(const k of Object.keys(state.months).sort()){ if(k<m||k>snapM) continue; const d=state.months[k];
    const adds=d.growth?Object.values(d.growth).reduce((a,x)=>a+(x.rec||0),0):d.sales?Object.values(d.sales).reduce((a,x)=>a+(x.rec||0),0):0;
    const canc=d.cancel?Object.values(d.cancel).reduce((a,x)=>a+(x.n||0),0):0;
    v=v-adds+canc; }
  return v;
}
// Active annual $ at the start of month m: today's customer list, rolled back with recurring $ started and $ cancelled since
function monthStartedVal(d){ return d?.sales?Object.values(d.sales).reduce((a,x)=>a+(x.recVal||0),0):0; }
function monthCancelVal(d){ return d?.cancel?Object.values(d.cancel).reduce((a,x)=>a+(x.prod||0),0):0; }
function baseDollarsAtStart(m,base){
  if(!base) return null; const snapM=base.asOf.slice(0,7);
  let v=base.branch.annual;
  for(const k of Object.keys(state.months).sort()){ if(k<m||k>snapM) continue; const d=state.months[k]; v=v-monthStartedVal(d)+monthCancelVal(d); }
  return v;
}
/* ---------- aggregation ---------- */
const monthIdx=m=>(+m.slice(0,4))*12+(+m.slice(5,7));
function monthElapsed(m,asOf){ const now=todayStr().slice(0,7); if(m<now) return 1; if(m>now) return 0; return workdayShare(m,asOf&&asOf.slice(0,7)===m?asOf:todayStr()); }
function yearElapsed(month,ms,asOf){ return ms.length?(ms.length-1+monthElapsed(month,asOf)):0; }
// On pace / off pace against the monthly targets; after the month closes it reads goal met / missed
function paceBadge(kind,v,el,ytd,basis){
  if(v==null) return '';
  if(!ytd&&!(el>0)) return '';
  // Year to date: the dollar cancel % is measured against the Jan 1 book, so its goal adds up month by month (1.7% × months).
  // Any other year-to-date rate (stops-based cancel %, void %, completion) is a straight rate against the monthly goal.
  const final=!ytd&&el>=1, share=ytd?(kind==='cancel'&&basis==='dollars'?el:1):el;
  let ok;
  if(kind==='completion') ok=v>=TARGET.completion*share;
  else ok=v<=TARGET[kind==='cancel'?'cancel':'void']*share; // both build up as the month goes on
  const txt=final?(ok?'GOAL MET':'GOAL MISSED'):(ok?'ON PACE':'OFF PACE');
  return `<span class="pb ${ok?'ok':'no'}">${txt}</span>`;
}

function monthsIn(month,mode){ const all=Object.keys(state.months).sort(); return mode==='month'?all.filter(m=>m===month):all.filter(m=>m.slice(0,4)===month.slice(0,4)&&m<=month); }
function blank(r){ return {id:r.id,display:r.display,status:r.status,emp:r.emp,sched:0,schedN:0,acq:0,voidAmt:0,cvN:0,cvAmt:0,cvExtra:0,vReasons:{},c:0,prod:0,age:[0,0,0,0,0,0],ageProd:[0,0,0,0,0,0],reasons:{},cByM:{},
  rec:0,recVal:0,ot:0,otRev:0,leads:0,leadVal:0,adds:0,otUnits:0,done:0,voided:0,open:0,stops:0,stopsProd:0,cR:0,dR:0}; }
function compute(month,mode){
  const ms=monthsIn(month,mode); if(!ms.length) return null;
  const has={cancel:false,sales:false,route:false,open:false,growth:false}, P={}; let staleGrowth=false;
  const CL={svc:new Set(),loc:{},any:false};
  for(const [cm,cd] of Object.entries(state.months)) for(const x of cd.cancelLocs||[]){ CL.any=true; CL.svc.add(x); const l=x.split('|')[0]; (CL.loc[l]||(CL.loc[l]=[])).push(cm); }
  const cross={total:0,matched:0,unmatched:[],nsN:0,nsAmt:0};
  const get=key=>{ const r=resolveKey(key); return P[r.id]||(P[r.id]=blank(r)); };
  let asOf=null;
  for(const m of ms){
    const d=state.months[m]||{};
    if(d.cancel){ has.cancel=true; for(const [k,v] of Object.entries(d.cancel)){ const t=get(k); t.c+=v.n; t.prod+=v.prod||0;
      (v.age||[]).forEach((x,i)=>t.age[i]+=x); (v.ageProd||[]).forEach((x,i)=>t.ageProd[i]+=x);
      for(const [r,n] of Object.entries(v.reasons||{})) t.reasons[r]=(t.reasons[r]||0)+n;
      t.cByM[m]=(t.cByM[m]||0)+v.n; if(d.route) t.cR+=v.n; } }
    if(d.growth){ has.growth=true; for(const [k,v] of Object.entries(d.growth)){ const t=get(k); t.adds+=v.rec||0; t.otUnits+=v.ot||0; if(v.recVal!=null){ t.addVal=(t.addVal||0)+v.recVal; has.growthVal=true; } } }
    else if(d.sales) staleGrowth=true;
    const openCounts=mode==='month'||monthElapsed(m)>=1; // year to date: open stops in an unfinished month aren't misses yet
    if(d.route){ has.route=true; for(const [k,v] of Object.entries(d.route)){ const t=get(k); t.done+=v.done||0; t.voided+=v.voided||0; if(openCounts) t.open+=v.open||0; t.voidAmt+=v.voidAmt||0; t.cvN+=v.cv||0; t.cvAmt+=v.cvAmt||0; t.sched+=v.sched||0; t.schedN+=v.schedN||0; t.acq+=v.acq||0;
        for(const [r,n] of Object.entries(v.reasons||{})) t.vReasons[r]=(t.vReasons[r]||0)+n; if(d.cancel) t.dR+=v.done||0; }
      const ns=d.sources?.route?.ns; if(ns){ cross.nsN+=ns.n||0; cross.nsAmt+=ns.amt||0; }
      // Cross-check: route services voided as CANCELED against the cancel detail
      for(const x of d.routeCV||[]){ cross.total++;
        const hit=CL.svc.has(x.loc+'|'+x.svc)||(CL.loc[x.loc]||[]).some(cm=>Math.abs(monthIdx(cm)-monthIdx(m))<=1);
        if(hit||!CL.any) { cross.matched++; continue; }
        const t=get(x.k); t.c++; t.cvExtra++; t.cByM[m]=(t.cByM[m]||0)+1; if(d.route) t.cR++; cross.unmatched.push({...x,m,name:resolveKey(x.k).display}); }
      if(mode==='month') asOf=d.sources?.route?.asOf||null; }
    if(mode==='month'&&d.open){ has.open=true; for(const [code,v] of Object.entries(d.open)){ const k=state.roster.codes?.[code]||('code|'+code.toLowerCase()); const t=get(k); t.stops+=v.stops||0; t.stopsProd+=v.prod||0; } }
  }
  const base=latestBase();
  if(base){ for(const [code,v] of Object.entries(base.tech)){ const k=state.roster.codes?.[code]||('code|'+code.toLowerCase()); const t=get(k); t.bSetups=(t.bSetups||0)+v.setups; t.bCust=(t.bCust||0)+v.customers; t.bAnnual=(t.bAnnual||0)+v.annual; t.bAge=(t.bAge||[0,0,0,0,0,0]).map((x,i)=>x+v.age[i]); } }
  for(const e of state.roster.employees||[]){
    const id='e'+e.id; if(P[id]) continue;
    const r=resolveKey((e.last+'|'+e.first).toLowerCase());
    if(r.id===id&&r.status==='board') P[id]=blank(r);
  }
  const all=Object.values(P);
  const B=blank({id:'branch',display:'Branch total',status:'branch'});
  for(const t of all){ for(const f of ['c','prod','rec','recVal','ot','otRev','leads','leadVal','adds','otUnits','done','voided','open','stops','stopsProd','cR','dR','voidAmt','cvN','cvAmt','cvExtra','sched','schedN','acq']) B[f]+=t[f];
    for(const [r,n] of Object.entries(t.vReasons)) B.vReasons[r]=(B.vReasons[r]||0)+n;
    t.age.forEach((x,i)=>{B.age[i]+=x;B.ageProd[i]+=t.ageProd[i];}); for(const [r,n] of Object.entries(t.reasons)) B.reasons[r]=(B.reasons[r]||0)+n;
    for(const [m,n] of Object.entries(t.cByM)) B.cByM[m]=(B.cByM[m]||0)+n; }
  const el=mode==='month'?monthElapsed(month,asOf):yearElapsed(month,ms,asOf);
  const rateOK=ms.every(m=>!state.months[m]?.cancel||state.months[m]?.route);
  // Tech-level cancel % only for recent single months: routes get reassigned, so older or year-long tech numbers would mislead
  const monthsBack=base?((+base.asOf.slice(0,4))*12+(+base.asOf.slice(5,7)))-((+month.slice(0,4))*12+(+month.slice(5,7))):99;
  const techRateOK=!!base&&mode==='month'&&monthsBack>=0&&monthsBack<=3;
  const derive=t=>{
    t.cancels=has.cancel||t.cvExtra?t.c:null;
    t.book=base?(t.bSetups||0):null; t.bookCust=base?(t.bCust||0):null;
    t.cancelShare=has.cancel&&B.c?t.c/B.c*100:null;
    t.cancelRate=null;
    t.completed=has.route?t.done:null;
    // Stops: open orders at the start of the month plus every sale added since (cancellations never take stops away);
    // without open orders, every order on the route report (not-started already removed)
    t.newStops=has.open&&has.growth?(t.adds||0)+(t.otUnits||0):0; t.startStops=has.open?t.stops:null;
    // Stops come from the route completion report whenever it's loaded: it reflects today's route assignments (new techs,
    // reassigned routes) and every stop added after the 1st, the same totals as Power BI's Route Completion by Technician.
    // The open-orders file is only the fallback before the month's first route report.
    // Acquisition voids and not-started sales are left out, like Power BI's totals.
    if(has.route){ t.stops=t.done+t.voided+t.cvN+t.open; t.newStops=0; t.startStops=null; }
    else t.stops=has.open?t.stops+t.newStops:null;
    // Cancel % (company Net Gain report): annual $ cancelled ÷ active annual $ on the book at the start of the period.
    // Techs: the annual $ on their route in the customer list, plus what cancelled, minus what started, this period.
    // Without a customer list it falls back to cancels ÷ total stops.
    if(base&&has.cancel){ const den=(t.bAnnual||0)+t.prod-(t.addVal||0); t.cancelPct=den>0?t.prod/den*100:null; t.bookStartVal=den; t.cancelBasis='dollars'; }
    else { const cNum=mode==='month'?t.c:t.cR; t.cancelPct=has.cancel&&t.stops?cNum/t.stops*100:null; t.cancelBasis='stops'; }
    // Void %: voided services ÷ total stops for the period
    // Void % (company view, unit count): voided orders ÷ orders scheduled on the month's route report. Voids include orders
    // voided because the customer cancelled; not-started sales and acquisition voids are left out.
    // Uploads from before order counts were kept fall back to voided orders ÷ total stops.
    t.voidN=t.voided+t.cvN; t.voidVal=t.voidAmt+t.cvAmt;
    // void % shares the completion denominator: every order on the route report except not-started and acquisition voids
    t.voidRate=has.route&&t.stops?t.voidN/t.stops*100:null; t.voidBasis='orders';
    t.adds=has.growth?t.adds:null; t.otUnits=has.growth?t.otUnits:null;
    t.netGain=has.growth&&has.cancel?t.adds-t.c:null;
    // Net gain $ = recurring annual $ started on the route − annual $ cancelled (company Net Gain report)
    t.netGainVal=has.growthVal&&has.cancel?(t.addVal||0)-t.prod:null;
    t.comp=has.route&&t.stops?t.done/t.stops*100:null;
    t.pace=mode==='month'&&t.comp!=null&&el>0?t.comp/(TARGET.completion*el)*100:null;
    t.ahead=t.pace!=null?Math.round(t.done-t.stops*TARGET.completion/100*el):null;
  };
  all.forEach(derive);
  B.bSetups=base?base.branch.setups:0; B.bCust=base?base.branch.customers:0; B.bAnnual=base?base.branch.annual:0; B.bAge=base?base.branch.age:null;
  derive(B);
  // Customer-list base: setups (for the Cancellations tab's net cancel %) and annual $ (for the company cancel %)
  if(base&&has.cancel){ const start=baseAtStart(ms[0],base); B.startBase=start; B.baseCancelPct=start>0?B.c/start*100:null;
    const sv=baseDollarsAtStart(ms[0],base); B.bookStartVal=sv; B.cancelPct=sv>0?B.prod/sv*100:null; B.cancelBasis='dollars'; }
  // Year to date (branch): net out new recurring setups and their annual value, the way the BI report does
  B.addVal=0; for(const m of ms){ const d=state.months[m]; if(d?.sales) for(const v of Object.values(d.sales)) B.addVal+=v.recVal||0; }
  B.netCancels=has.growth&&has.cancel?B.c-B.adds:null;
  B.netCancelPct=B.netCancels!=null&&B.startBase>0?B.netCancels/B.startBase*100:null;
  B.netProd=has.cancel&&B.addVal?B.prod-B.addVal:null;
  B.netGainVal=has.cancel&&ms.some(m=>state.months[m]?.sales)?B.addVal-B.prod:null; // branch started $ comes from every sale, not just route techs
  // started and cancelled $ by service class, against each class's active annual $
  B.byClass={};
  for(const m of ms){ const d=state.months[m]; if(!d) continue;
    for(const [c,v] of Object.entries(d.salesClass||{})){ const x=B.byClass[c]||(B.byClass[c]={start:0,startN:0,canc:0,cancN:0}); x.start+=v.rec||0; }
    for(const [c,v] of Object.entries(d.cancelClass||{})){ const x=B.byClass[c]||(B.byClass[c]={start:0,startN:0,canc:0,cancN:0}); x.canc+=v.prod||0; x.cancN+=v.n||0; } }
  B.classReady=ms.some(m=>state.months[m]?.cancelClass);
  const board=all.filter(t=>t.status==='board');
  // workload = the tech's share of all stops on ranked routes
  const boardStops=board.reduce((a,t)=>a+(t.stops||0),0);
  for(const t of board) t.workload=t.stops!=null&&boardStops?t.stops/boardStops*100:null;
  const cancelDim=board.some(t=>t.cancelPct!=null)?'cancelPct':'cancelShare';
  const dims=[[cancelDim,-1],['voidRate',-1],['pace',1],['netGain',1],['netGainVal',1],['adds',1],['otUnits',1],['rec',1],['recVal',1],['otRev',1],['leads',1],['completed',1],['stops',1],['cancelShare',-1],['cancelPct',-1],['book',1],['comp',1],['workload',1]];
  board.forEach(t=>t.p={});
  for(const [f,dir] of dims){
    const vals=board.map(t=>t[f]).filter(v=>v!=null); if(vals.length<2) continue;
    for(const t of board){ if(t[f]==null) continue; const better=vals.filter(v=>dir<0?v>t[f]:v<t[f]).length, ties=vals.filter(v=>v===t[f]).length-1; t.p[f]=(better+ties/2)/(vals.length-1); }
  }
  // Health score: weighted pieces (see SCORE_WEIGHTS). Missing pieces are left out and the rest scaled back to 100.
  const netDim=board.some(t=>t.netGainVal!=null)?'netGainVal':'netGain';
  const scoreDims={completion:'comp',workload:'workload',cancel:cancelDim,void:'voidRate',net:netDim};
  for(const t of board){
    t.scoreParts={}; let got=0,max=0;
    for(const [k,f] of Object.entries(scoreDims)){ const v=t.p[f]; if(v==null) continue; const w=SCORE_WEIGHTS[k]; t.scoreParts[k]={pts:v*w,w}; got+=v*w; max+=w; }
    t.health=max?Math.round(got/max*SCORE_MAX):null; t.p.health=t.health==null?null:t.health/SCORE_MAX; // points out of 160
  }
  return {board,termed:all.filter(t=>t.status==='termed'),staff:all.filter(t=>t.status==='staff'),other:all.filter(t=>t.status==='other'),main:all.filter(t=>t.status==='main'),B,has,ms,el,asOf,cancelDim,netDim:board.some(t=>t.netGainVal!=null)?'netGainVal':'netGain',staleGrowth,base,techRateOK,cross,ytd:mode==='ytd',stopsSrc:has.route?'route':'open'};
}
function sortList(list,key,sec){ const s=SORTS[sec].find(x=>x.key===key)||{dir:-1};
  return [...list].sort((a,b)=>{ if(a[key]==null&&b[key]==null) return a.display.localeCompare(b.display); if(a[key]==null) return 1; if(b[key]==null) return -1; return (a[key]-b[key])*s.dir||a.display.localeCompare(b.display); }); }

/* ---------- render ---------- */
function defaultMonth(){ const ms=Object.keys(state.months).filter(m=>m>=START_MONTH).sort(); const full=ms.filter(m=>{const d=state.months[m];return d.cancel||d.sales||d.route;}); return full.pop()||ms.pop()||null; }
function render(){
  if(DISTRICT){ renderDistrict($('#content')); wireBody($('#content')); return; }
  document.querySelectorAll('[data-sec]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.sec===state.sec));
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===state.mode));
  const ms=Object.keys(state.months).filter(m=>m>=START_MONTH).sort();
  if(!ms.includes(state.month)) state.month=defaultMonth();
  const sel=$('#monthSel');
  sel.innerHTML=ms.length?ms.slice().reverse().map(m=>`<option value="${m}" ${m===state.month?'selected':''}>${esc(monthName(m))}</option>`).join(''):'<option>No reports yet</option>';
  sel.disabled=!ms.length;
  sel.style.display=state.mode==='ytd'?'none':'';
  document.querySelectorAll('.admin').forEach(el=>el.style.display=state.canEdit===false?'none':'');
  $('#banner').innerHTML=bannerHTML();
  const c=$('#content');
  if(!state.month){
    c.innerHTML=state.canEdit===false?'<div class="empty"><h2>No numbers posted yet</h2><p>Check back once the reports are in.</p></div>'
      :'<div class="empty">'+bill('Load up the reports and I’ll line up every route on the target.','Ready when you are')+'<h2>Start with your exports</h2><p>Upload the employment list, cancel detail, sales details, route completion details and open orders. Each one is recognized automatically.</p><button class="btn" type="button" id="emptyUp">Upload reports</button></div>';
    $('#emptyUp')?.addEventListener('click',openUpload); return;
  }
  if(state.mode==='ytd') renderYTD(c); else if(state.sec==='cancel') renderCancel(c); else if(state.sec==='sales') renderSales(c); else renderBoard(c);
  c.querySelectorAll('[data-sp]').forEach(b=>b.onclick=()=>openSales(b.dataset.sp));
  c.querySelectorAll('[data-branch]').forEach(b=>b.onclick=()=>openBranch(b.dataset.branch));
  if(state.mode==='month') wireLists(c); else c.querySelectorAll('[data-list]').forEach(x=>{ x.removeAttribute('data-list'); x.classList.remove('clk'); });
  $('#goalsBtn')?.addEventListener('click',()=>openGoals());
  c.querySelectorAll('[data-tech]').forEach(b=>b.onclick=()=>openTech(b.dataset.tech));
  c.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>removeSource(b.dataset.rm));
  c.querySelectorAll('[data-rmbase]').forEach(b=>b.onclick=()=>removeBase(b.dataset.rmbase));
  $('#emptyUp')?.addEventListener('click',openUpload);
  if(state.canEdit===false) c.querySelectorAll('.admin').forEach(el=>el.style.display='none');
}
// Year to date always runs through the latest month uploaded for the year, whatever month is picked
function ytdEnd(){ const y=(state.month||todayStr()).slice(0,4); const ms=Object.keys(state.months).filter(m=>m.slice(0,4)===y).sort(); return ms[ms.length-1]||state.month; }
function curMonth(){ return state.mode==='ytd'?ytdEnd():state.month; }
function periodLabel(){ const m=curMonth(); return state.mode==='month'?monthName(m):`${m.slice(0,4)} year to date, January through ${monthName(m,true)}`; }
function excludedNote(R){
  const names=(l)=>l.map(t=>`<button type="button" class="linkish" data-tech="${esc(t.id)}">${esc(t.display)}</button>`).join(', ');
  const parts=[];
  if(R.termed.length) parts.push(`termed employees (${names(R.termed)})`);
  if(R.main.length) parts.push(`main branch (${names(R.main)})`);
  if(R.staff.length) parts.push(`office and sales staff (${names(R.staff)})`);
  if(R.other.length) parts.push(`open routes and other (${names(R.other)})`);
  return parts.length?`Includes ${parts.join('; ')}. Only active ${LOCATION} field employees are ranked.`:`Everyone in these reports is an active ${LOCATION} field employee.`;
}
function renderBoard(c){
  const sec=state.sec, R=compute(state.month,state.mode), B=R.B;
  const avail=SORTS[sec].filter(s=>s.key==='health'?R.board.some(t=>t.health!=null):s.key==='comp'?R.board.some(t=>t.stops!=null):R.board.some(t=>t[s.key]!=null)).filter(s=>!(s.key==='cancelShare'&&R.board.some(t=>t.cancelPct!=null)));
  if(!avail.length){
    const need=sec==='route'?'cancel detail, route completion details or open orders':'sales details';
    c.innerHTML=`<div class="empty"><h2>No ${sec} numbers for ${esc(periodLabel())}</h2><p>Upload the ${need} covering this period.</p>${state.canEdit===false?'':'<button class="btn" type="button" id="emptyUp">Upload reports</button>'}</div>${sourcesBlock()}`; return;
  }
  if(!avail.some(s=>s.key===state.sort[sec])) state.sort[sec]=avail[0].key;
  const sk=state.sort[sec], sdef=SORTS[sec].find(s=>s.key===sk);
  let PR=null;
  if(state.mode==='month'){ const ms=Object.keys(state.months).filter(m=>m>=START_MONTH).sort(); const i=ms.indexOf(state.month); if(i>0) PR=compute(ms[i-1],'month'); }
  const prev=PR?Object.fromEntries(PR.board.map(t=>[t.id,t])):{};
  const tiles=routeTiles(R,false);
  const hints={health:`Points out of ${SCORE_MAX} for the month, ranked against the team: route completion ${SCORE_WEIGHTS.completion+SCORE_WEIGHTS.workload}, cancel % ${SCORE_WEIGHTS.cancel}, void % ${SCORE_WEIGHTS.void}, net gain ${SCORE_WEIGHTS.net}. The best on each piece earns its full points.`,
    cancelPct:R.B.cancelBasis==='dollars'?`Annual dollars cancelled as a share of the active annual dollars on the book at the start of the ${state.mode==='month'?'month':'year'}, the Cancellation % in the company Net Gain report. Goal: no more than ${TARGET.cancel}% by month end. For techs, the book is the annual dollars on their route in the customer list.`:`Setups cancelled as a share of total stops. Upload the customer list to switch to the company’s dollar-based cancel %. Goal: no more than ${TARGET.cancel}%.`,
    book:'Active service setups on each tech’s route today, from the customer list after removing duplicates.',
    cancelRate:'Cancellations on the tech’s accounts for every 100 services they completed. Lower is better.',
    cancelShare:'Each tech’s share of all branch cancellations.',
    voidN:`Voided orders on each tech’s route this ${state.mode==='month'?'month':'period'}, fewest first. Includes orders voided because the customer cancelled; not-started sales and acquisitions are left out. The badge follows the void % goal (no more than ${TARGET.void}% of scheduled orders).`,
    voidRate:`Voided orders as a share of all orders scheduled for the ${state.mode==='month'?'month':'period'} (a unit count), the way the company measures it. Includes orders voided because the customer cancelled; not-started sales and acquisitions are left out. Goal: no more than ${TARGET.void}% by month end.`,
    comp:`Stops completed out of stops assigned${R.stopsSrc==='route'?' (every order on the route completion report: current route assignments, including stops added during the month)':' (open orders at the start of the month, until the first route completion report is uploaded)'}. Goal: ${TARGET.completion}% by month end${R.el<1?`, so about ${(TARGET.completion*R.el).toFixed(1)}% by now`:''}.`,
    completed:'Services completed. Higher is better.', adds:'New recurring customers placed on the tech’s route, counted as units.', stops:'Stops on the books from the open orders report at the start of the month.',
    netGain:'Customers started on the tech’s route minus customers who cancelled. One cancel needs one new start to break even.',
    netGainVal:'Recurring annual dollars started on the tech’s route minus annual dollars cancelled, the Net Gain in the company report. Above zero means the route grew.',
    rec:'New recurring customers placed on the tech’s route.', recVal:'Annual value of new recurring customers on the route.',
    otRev:'One-time service revenue on the tech’s route.', leads:'Sales where the tech is credited as the lead.'};
  const maxVal=Math.max(...R.board.map(t=>Math.abs(t[sk]??0)),0.0001);
  const chipsFor=t=>{ const on=k=>k===sk?'on':''; const ch=[];
    if(sec==='route'){
      if(sk!=='health'&&t.health!=null) ch.push(`<span><b>${t.health}</b> pts</span>`);
      if(t.stops!=null) ch.push(`<span class="${on('comp')}">${t.completed!=null?`<b>${t.completed.toLocaleString()}</b> of `:''}${t.stops.toLocaleString()} stops${t.comp!=null?` · <b>${pct1(t.comp)}</b>`:t.completed==null?' scheduled':''} ${paceBadge('completion',t.comp,R.el)}</span>`);
      if(t.cancels!=null) ch.push(`<span class="${on('cancelPct')} ${on('cancelRate')} ${on('cancelShare')} clk" data-list="cancel" data-who="${esc(t.id)}" title="See each cancellation"><b>${t.cancels}</b> cancels${t.cancelBasis==='dollars'&&t.prod?` (${money(t.prod)})`:''}${t.cancelPct!=null?` · <b>${pctG(t.cancelPct,TARGET.cancel)}</b> ${paceBadge('cancel',t.cancelPct,R.el,R.ytd)}`:''}</span>`);
      if(t.voidRate!=null) ch.push(`<span class="${on('voidN')} clk" data-list="void" data-who="${esc(t.id)}" title="See each void"><b>${t.voidN}</b> void${t.voidN===1?'':'s'} ${paceBadge('void',t.voidRate,R.el,R.ytd)}</span>`);
      if(t.netGain!=null) ch.push(`<span class="${on('netGain')} ${on('netGainVal')} ${on('adds')}">net <b>${fmt('netGain',t.netGain)}</b> (${t.adds} started, ${t.cancels} cancelled)</span>`);

    } else {
      if(t.netGain!=null&&sk!=='netGain') ch.push(`<span>net <b>${fmt('netGain',t.netGain)}</b></span>`);
      if(t.rec!=null) ch.push(`<span class="${on('rec')}"><b>${t.rec}</b> recurring</span>`);
      if(t.cancels!=null) ch.push(`<span><b>${t.cancels}</b> cancels</span>`);
      if(t.recVal) ch.push(`<span class="${on('recVal')}"><b>${money(t.recVal)}</b>/yr</span>`);
      if(t.otRev) ch.push(`<span class="${on('otRev')}"><b>${money(t.otRev)}</b> one-time</span>`);
      if(t.leads) ch.push(`<span class="${on('leads')}"><b>${t.leads}</b> leads</span>`);
    }
    return ch.join(''); };
  c.innerHTML=`
    ${kpiStrip(tiles,'route')}
    ${billRoute(R,false)}
    <p class="periodline">${esc(periodLabel())}${R.asOf?` · route data through ${esc(new Date(R.asOf+'T12:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}))}`:''}${PR?` · arrows compare with ${esc(monthName(PR.ms[0],true))}`:''}${R.staleGrowth?' · <span style="color:var(--low)">re-upload sales details for route growth</span>':''}</p>
    <nav class="tabs" aria-label="Rank by">${avail.map(s=>`<button type="button" data-sort="${s.key}" aria-pressed="${s.key===sk}">${s.label}</button>`).join('')}</nav>
    <p class="hint">${hints[sk]||''}</p>
    <button type="button" class="branch" data-branch="route"><span class="who"><span class="name">Branch total</span><span class="chips">${chipsFor(B)}</span></span>
      <span class="score"><span class="num">${sk==='health'||sk==='cancelShare'?'':sk==='cancelRate'?'':fmt(sk,B[sk])}</span><span class="more">Details ›</span></span></button>
    <ol class="board">${sortList(R.board,sk,sec).map((t,i)=>{
      const p=t.p[sk];
      const pos=sk==='health'?Math.round((t.health??0)/SCORE_MAX*100):Math.round(Math.abs(t[sk]??0)/maxVal*100);
      let delta=''; const pv=prev[t.id];
      if(pv&&pv[sk]!=null&&t[sk]!=null){ const d=t[sk]-pv[sk], good=sdef.dir<0?d>0:d<0;
        const shown=PCT.includes(sk)?Math.abs(d).toFixed(1)+(sk==='cancelRate'?'':'%'):MONEY.includes(sk)?money(Math.abs(d)):Math.abs(Math.round(d));
        delta=Math.abs(d)>=0.05?`<span class="delta ${good?'up':'down'}">${d>0?'▲':'▼'} ${shown}</span>`:'<span class="delta">no change</span>'; }
      const big=sk==='health'?(t.health??'—'):sk==='cancelRate'&&t.cancelRate!=null?t.cancelRate.toFixed(1):fmt(sk,t[sk]);
      return `<li><button type="button" class="lane ${band(p)} ${i<3&&t[sk]!=null?'top':''}" data-tech="${esc(t.id)}">
        <span class="rank">${t[sk]==null?'–':i+1}</span>
        <span class="who"><span class="name">${esc(t.display)}</span><span class="chips">${chipsFor(t)}</span></span>
        <span class="score"><span class="num">${big}</span>${delta}</span>
        <span class="road" aria-hidden="true"><span class="fill" style="width:${pos}%"></span><span class="pin" style="left:${Math.min(Math.max(pos,1),99)}%"></span></span></button></li>`;
    }).join('')}</ol>${sourcesBlock()}`;
  c.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{state.sort[sec]=b.dataset.sort;render();});
}
function routeTiles(R,ytd){
  const B=R.B, el=R.el, t=[], L=!ytd&&state.mode==='month';
  if(B.stops!=null&&(B.completed!=null||!ytd)) t.push(['Stops completed',B.comp!=null?pct1(B.comp):'—',(B.completed!=null?`${B.completed.toLocaleString()} of ${B.stops.toLocaleString()} stops`:`${B.stops.toLocaleString()} stops scheduled · upload route completion to track`)+(B.newStops?` (${B.startStops.toLocaleString()} at the start + ${B.newStops} new sales)`:'')+` · goal ${TARGET.completion}%`,paceBadge('completion',B.comp,el,ytd)]);
  if(B.cancels!=null) t.push(['Cancel %',B.cancelPct!=null?pctG(B.cancelPct,TARGET.cancel):'—',B.cancelBasis==='dollars'?`${money(B.prod)} cancelled of ${money(B.bookStartVal)} active annual $ · ${B.cancels} setup${B.cancels===1?'':'s'} · goal ≤${ytd?(TARGET.cancel*el).toFixed(1):TARGET.cancel}%${L?' · tap to see each':''}`:`${ytd&&B.stops!=null?B.cR:B.cancels} setups cancelled${B.stops!=null?` of ${B.stops.toLocaleString()} stops${ytd?' (months with route data)':''}`:''} · goal ≤${TARGET.cancel}%${L?' · tap to see each':''}`,paceBadge('cancel',B.cancelPct,el,ytd,B.cancelBasis),L?'cancel':null]);
  if(B.voidRate!=null) t.push(['Void %',pctG(B.voidRate,TARGET.void),`${B.voidN} voided of ${B.stops.toLocaleString()} orders · ${money(B.voidVal)} not billed · goal ≤${TARGET.void}%${L?' · tap to see each':''}`,paceBadge('void',B.voidRate,el,ytd),L?'void':null]);
  // Branch tile stays in dollars (company Net Gain view); tech rows use customer counts
  if(B.netGainVal!=null) t.push(['Net gain',fmt('netGainVal',B.netGainVal),`${money(B.addVal)} started − ${money(B.prod)} cancelled · ${B.adds??'—'} started, ${B.cancels} cancelled`,`<span class="pb ${B.netGainVal>=0?'ok':'no'}">${B.netGainVal>=0?'GAINING':'SHRINKING'}</span>`]);
  else if(B.netGain!=null) t.push(['Net gain',fmt('netGain',B.netGain),`${cust(B.adds)} started − ${B.c} cancelled`,`<span class="pb ${B.netGain>=0?'ok':'no'}">${B.netGain>=0?'GAINING':'SHRINKING'}</span>`]);
  return t;
}
function renderYTD(c){
  const sec=state.sec, R=compute(ytdEnd(),'ytd');
  if(!R){ c.innerHTML=`<div class="empty"><h2>No numbers for ${esc(periodLabel())}</h2></div>`; return; }
  const parts=[];
  if(sec==='route'){
    parts.push(kpiStrip(routeTiles(R,true),'route'));
    parts.push(billRoute(R,true));
    parts.push(`<p class="periodline">${esc(periodLabel())} · branch only · goals: ${TARGET.completion}% of stops completed, cancel % no more than ${TARGET.cancel}% of the book a month (${(TARGET.cancel*R.el).toFixed(1)}% so far this year), void % no more than ${TARGET.void}% of stops</p>`);
    parts.push((branchBody('route')||[]).join(''));
  } else if(sec==='sales'){
    const S=computeSales(ytdEnd(),'ytd'); if(!S){ c.innerHTML=`<div class="empty"><h2>No sales details for ${esc(periodLabel())}</h2></div>`; return; }
    const B=S.B, isVal=S.unit!=='accounts';
    parts.push(kpiStrip([...dorTile(S.dor),...(S.hasGoals?[['Salespeople vs. budget',B.goalPct!=null?pct1(B.goalPct):'—',`${money(B.captured)} of ${money(B.budget)} · ${S.budMonths.length} budgeted month${S.budMonths.length===1?'':'s'}`,B.goalPct!=null?`<span class="pb ${B.goalPct>=100?'ok':'no'}">${B.goalPct>=100?'BUDGET MET':'BUDGET MISSED'}</span>`:'']]:[]),
      ['Recurring sold',money(B.recVal),`${B.rec} setups`],['One-time & initial sold',money(B.otAll),`${B.ot} jobs + ${money(B.ex)} excess initial`],
      ...(S.cancels!=null?[['Net setups',fmt('netGain',B.rec-S.cancels),`${B.rec} added · ${S.cancels} cancelled`]]:[])],'sales'));
    { const closed=goalMonths(ytdEnd(),'ytd').filter(m=>m<curYM()); const last=closed[closed.length-1];
      parts.push(`<p class="periodline">${last?`${last.slice(0,4)} year to date, January through ${esc(monthName(last,true))} (closed months)`:'No closed months yet this year'} · branch only · ${esc(monthName(curYM()))} is tracked on pace in the Month view</p>`); }
    const ms=goalMonths(ytdEnd(),'ytd').filter(m=>state.months[m]?.sales&&m<curYM());
    const byM=m=>Object.values(state.months[m].sales).reduce((a,v)=>({rec:a.rec+(v.rec||0),recVal:a.recVal+(v.recVal||0),ot:a.ot+(v.ot||0),otRev:a.otRev+(v.otRev||0)+(v.ex||0)}),{rec:0,recVal:0,ot:0,otRev:0});
    parts.push(dorHTML(S.dor));
    parts.push(`<h3>By month</h3>`+rowsTable(['Month','Recurring','Recurring $/yr','One-time','One-time & initial $'],ms.map(m=>{const x=byM(m);return [monthName(m,true),x.rec,money(x.recVal),x.ot,money(x.otRev)];})));
    parts.push((branchBody('sales')||[]).join(''));
  } else {
    const B=R.B;
    parts.push(kpiStrip([['Cancelled',(B.cancels??0).toLocaleString(),`setups · ${B.adds??0} recurring added`],
      ...(B.netCancelPct!=null?[['Net cancel %',pct1(B.netCancelPct),`${B.netCancels} net of ${B.startBase.toLocaleString()} active Jan 1 · gross ${pct1(B.cancelPct)} of the book in dollars`,'']]:B.cancelPct!=null?[['Cancel %',pct1(B.cancelPct),'of total stops','']]:[]),
      ...(B.netProd!=null?[['Net production',money(-B.netProd),`${money(B.prod)} lost − ${money(B.addVal)} added`]]:[['Production lost',money(B.prod),'annual value']])],'route'));
    parts.push(`<p class="periodline">${esc(periodLabel())} · branch only</p>`);
    const ms=R.ms.filter(m=>state.months[m]?.cancel||state.months[m]?.routeCV);
    const addsM=m=>{ const d=state.months[m]; return d?.growth?Object.values(d.growth).reduce((a,x)=>a+(x.rec||0),0):null; };
    parts.push(`<h3>By month</h3>`+rowsTable(['Month','Cancelled','Added','Net','Net cancel %','Gross cancel %'],ms.map(m=>{ const n=B.cByM[m]||0, ad=addsM(m), sb=R.base?baseAtStart(m,R.base):null;
      return [monthName(m,true),n,ad??'—',ad!=null?n-ad:'—',sb&&ad!=null?pct1((n-ad)/sb*100):'—',sb?pct1(n/sb*100):'—']; })));
    parts.push(`<h3>How long they’d been customers</h3>`+ageBlock(B,'the branch'));
    const reasons=Object.entries(B.reasons).sort((a,b)=>b[1]-a[1]).slice(0,8);
    if(reasons.length) parts.push(`<h3>Why they left</h3><div class="reasons">${reasons.map(([r,n])=>`<span>${esc(REASONS[r]||tc(r))}</span><span>${n}</span>`).join('')}</div>`);
  }
  parts.push(sourcesBlock());
  c.innerHTML=parts.join('');
  wireBody(c);
}
const BILL_IMG='../assets/bill.jpg';
function bill(msg,title){ return msg?`<div class="bill"><img src="${BILL_IMG}" alt="Bullseye Bill"><div class="bubble"><b>${esc(title||'Bullseye Bill says')}</b><p>${msg}</p></div></div>`:''; }
// Bill's read on the route goals
function billRoute(R,ytd){
  const B=R.B, el=R.el, hits=[], miss=[];
  if(!ytd&&!(el>0)) return '';
  if(B.comp!=null){ const g=TARGET.completion*(ytd?1:el); (B.comp>=g?hits:miss).push(B.comp>=g?`stops completed at ${pct1(B.comp)}`:`stops completed at ${pct1(B.comp)}, ${(g-B.comp).toFixed(1)} points under ${g.toFixed(1)}%`); }
  if(B.cancelPct!=null){ const share=ytd?(B.cancelBasis==='dollars'?el:1):Math.min(el,1), ok=B.cancelPct<=TARGET.cancel*share, allow=cancelAllowance(B.startBase,share), c=B.cancels||0;
    (ok?hits:miss).push(ok?`${cust(c)} cancelled${allow!=null?` (goal: about ${allow} or fewer)`:''}`:`${cust(c)} cancelled${allow!=null?`, about ${c-allow} more than the goal allows${!ytd&&el<1?' by this point in the month':''}`:''}`); }
  if(B.voidRate!=null){ const share=ytd?1:Math.min(el,1), ok=B.voidRate<=TARGET.void*share, allow=B.stops?Math.floor(TARGET.void/100*B.stops*share):null;
    (ok?hits:miss).push(ok?`${stopsW(B.voidN)} voided`:`${stopsW(B.voidN)} voided${allow!=null&&B.voidN>allow?`, ${B.voidN-allow} more than the goal allows`:''}`); }
  const n=hits.length+miss.length; if(!n) return '';
  const final=!ytd&&el>=1;
  const head=!miss.length?(final?'Bullseye! Every route goal was met.':'Right on target. Every route goal is on pace.'):!hits.length?(final?'We missed the target on every goal this month.':'We’re off target on every goal right now.'):`${hits.length} of ${n} on target.`;
  const cap=x=>x.charAt(0).toUpperCase()+x.slice(1);
  const net=B.netGain!=null?` ${cust(B.adds)} started and ${B.c} cancelled: ${B.netGain>=0?`up ${cust(B.netGain)}`:`${cust(-B.netGain)} short of breaking even`}.`:'';
  return bill(`${head}${miss.length?` ${cap(miss.join('; '))}.`:''}${hits.length&&miss.length?` Holding steady: ${hits.join(', ')}.`:''}${net}${state.mode==='month'&&B.c?' Tap a cancel or void count to see every customer.':''}`);
}
function kpiStrip(tiles,sec){
  if(!tiles.length) return '';
  return `<div class="kpis">${tiles.map(([l,v,sub,badge,list,cls,bar])=>`<button type="button" class="kpi ${cls||(badge&&badge.includes('pb no')?'off':badge?'onp':'')}" ${list?`data-list="${list}" data-who="branch"`:`data-branch="${sec}"`}><span class="l">${esc(l)}</span><span class="v">${v}</span>${bar||''}${badge||''}<span class="s">${sub||''}</span></button>`).join('')}</div>`;
}
const VOID_LBL={CANCELED:'Customer cancelled',REFUSE:'Customer refused',"NO PAY":'Non-payment',MISSED:'Missed',"NOT HOME":'Not home',ANIMALS:'Animals on site',"ADMN ERROR":'Admin error',ACQ:'Acquisition','NO REASON':'No reason given'};
function rowsTable(head,rows){ return `<div class="tbl"><table><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
function branchBody(sec){
  const body=[]; const ytd=state.mode==='ytd';
  if(sec==='sales'){
    const S=computeSales(curMonth(),state.mode); if(!S) return; const B=S.B, isVal=S.unit!=='accounts';
    body.push(`<h3>Sales</h3>`+rowsTable(['','Count','Value'],[['Recurring sales',B.rec,money(B.recVal)+' / yr'],['One-time sales',B.ot,money(B.otRev)],['Excess initial on recurring setups','',money(B.ex)],['<b>Total captured</b>','',`<b>${money(B.overall)}</b>`]]));
    if(!ytd&&S.dor) body.push(dorHTML(S.dor));
    if(S.hasGoals) body.push(`<h3>Salespeople vs. budget</h3><p class="sub">${money(B.captured)} captured of ${money(B.budget)} budgeted (${pct1(B.goalPct)}), combining everyone with a budget${state.mode==='ytd'?` across the ${S.budMonths.length} budgeted month${S.budMonths.length===1?'':'s'}`:''}.</p><span class="goals" style="display:grid">${goalBar('Recurring',B.gRec,B.recGoal,B.recPct,S.exp,isVal)}${goalBar('One-time',B.gOt,B.otGoal,B.otPct,S.exp,true)}</span>`);
    if(S.cancels!=null) body.push(`<h3>Net change in setups</h3><p>${B.rec} recurring added − ${S.cancels} cancelled = <b>${fmt('netGain',B.rec-S.cancels)}</b></p>`);
    if(B.early) body.push(`<h3>Sale quality</h3><p class="sub">${B.early} first-year cancellations (chargebacks) on ${B.rec} recurring sales. This feeds the sale-quality part of the sales score only; it isn’t subtracted from captured sales.</p>`);
    const names=l=>l.map(t=>`<button type="button" class="linkish" data-sp="${esc(t.id)}">${esc(t.display)}</button>`).join(', ');
    const grp=[['Main branch',S.main],['Techs and staff without a goal',S.staff],[`Not on the ${LOCATION} list (inside sales, other branches)`,S.outside],['Termed',S.termed],['Other',S.other]].filter(g=>g[1].length);
    if(grp.length&&!ytd) body.push(`<h3>Counted in the branch total, not ranked</h3>${grp.map(([l,list])=>`<p><b>${l}:</b> ${names(list)}</p>`).join('')}`);
  } else {
    const R=compute(curMonth(),state.mode); if(!R) return; const B=R.B, X=R.cross;
    if(R.base) body.push(`<h3>Active base</h3><p>${B.bCust.toLocaleString()} customers on <b>${B.bSetups.toLocaleString()}</b> service setups, ${money(B.bAnnual)} a year, as of ${esc(R.base.asOf)}.</p>`);
    if(B.cancels!=null){
      const fromDetail=B.c-B.cvExtra;
      body.push(`<h3>Cancellations</h3>`+rowsTable(['','Setups'],[
        ['From the cancel detail',fromDetail],
        ...(B.cvExtra?[['Voided as CANCELED on the route report, not yet in the cancel detail',B.cvExtra]]:[]),
        ['<b>Total cancelled</b>',`<b>${B.c}</b>`],
        ...(B.cancelPct!=null&&B.cancelBasis==='dollars'?[['Annual $ cancelled',money(B.prod)],[`Active annual $ at the start of the ${ytd?'year':'month'}`,money(B.bookStartVal)],[`<b>Cancel %</b> (goal ≤${ytd?(TARGET.cancel*R.el).toFixed(1):TARGET.cancel}%)`,`<b>${pctG(B.cancelPct,TARGET.cancel)}</b> ${paceBadge('cancel',B.cancelPct,R.el,ytd,B.cancelBasis)}`]]:B.cancelPct!=null?[[`<b>Cancel %</b> (of ${B.stops.toLocaleString()} total stops; goal ≤${TARGET.cancel}%)`,`<b>${pctG(B.cancelPct,TARGET.cancel)}</b> ${paceBadge('cancel',B.cancelPct,R.el,ytd,B.cancelBasis)}`]]:[]),
        ...(ytd&&B.baseCancelPct!=null?[[`Gross cancel % of the ${B.startBase.toLocaleString()} setups active Jan 1`,pct1(B.baseCancelPct)]]:[]),
        ...(ytd&&B.netCancels!=null?[['Recurring setups added',`− ${B.adds}`],['<b>Net cancelled</b>',`<b>${B.netCancels}</b>`],['<b>Net cancel %</b> (matches the BI report)',`<b>${pct1(B.netCancelPct)}</b>`]]:[]),
        ['Annual production lost',money(B.prod)],
        ...(ytd&&B.netProd!=null?[['Annual value of recurring setups added',`− ${money(B.addVal)}`],['<b>Net production lost</b>',`<b>${money(B.netProd)}</b>`]]:[])]));
    }
    if(!ytd&&(B.c||B.voidN)) body.push(`<div class="actions"><button type="button" class="ghost" data-list="cancel" data-who="branch">See all ${B.c} cancellation${B.c===1?'':'s'}</button><button type="button" class="ghost" data-list="void" data-who="branch">See all ${B.voidN} void${B.voidN===1?'':'s'}</button></div>`);
    if(X.total&&!ytd) body.push(`<h3>Cross-check: route report vs. cancel detail</h3><p>${X.total} route services were voided with the reason CANCELED. ${X.matched} match a cancellation already in the cancel detail, so they aren’t counted twice.${X.unmatched.length?` ${X.unmatched.length} don’t match and were added to the cancel count:`:' All of them matched.'}</p>
      ${X.unmatched.length?`<ul class="plain">${X.unmatched.map(u=>`<li>Location ${esc(u.loc)} · ${esc(u.svc)} · ${esc(u.name)} · ${esc(monthName(u.m,true))}</li>`).join('')}</ul><p class="sub">These usually show up in the next cancel detail; once they do, they’re matched automatically.</p>`:''}`);
    if(B.voidRate!=null){
      const vr=Object.entries(B.vReasons).sort((a,b)=>b[1]-a[1]);
      body.push(`<h3>Voids</h3><p>Orders voided this ${ytd?'year':'month'}, counted the way the company report counts them: every void except not-started sales and acquisitions, including orders voided because the customer cancelled.</p>`+rowsTable(['',''],[['Total orders',B.stops.toLocaleString()],['Completed',B.done.toLocaleString()],['Voided orders',`${B.voidN}${B.cvN?` (${B.cvN} because the customer cancelled)`:''}`],['Revenue not billed',money(B.voidVal)],[`<b>Void %</b> (voided orders ÷ total orders; goal ≤${TARGET.void}%)`,`<b>${pctG(B.voidRate,TARGET.void)}</b> ${paceBadge('void',B.voidRate,R.el,ytd)}`],...(B.open?[['Still open',B.open]]:[])])
        +(vr.length||B.cvN?`<h3>Void reasons</h3>`+rowsTable(['Reason','Voids'],[...vr,...(B.cvN?[['CANCELED',B.cvN]]:[])].sort((a,b)=>b[1]-a[1]).map(([r,n])=>[esc(VOID_LBL[r]||tc(r)),n])):''));
    }
    if(X.nsN) body.push(`<p class="sub">${X.nsN} not-started services (${money(X.nsAmt)}) were removed. These are sales that backed out before the first visit.</p>`);
    if(B.stops!=null) body.push(`<h3>Stops</h3>`+rowsTable(['',''],[
      [R.stopsSrc==='open'?'Stops assigned (open orders at the start of the month)':'Stops assigned (route completion report, current assignments)',B.stops.toLocaleString()],
      ...(B.stopsProd?[['Value on the books',money(B.stopsProd)]]:[]),
      ...(B.completed!=null?[['Stops completed',B.completed.toLocaleString()],[`<b>Completed</b> (goal ${TARGET.completion}%)`,`<b>${pct(B.comp)}</b> ${paceBadge('completion',B.comp,R.el,ytd)}`]]:[]),
      ...(B.ahead!=null?[[B.ahead>=0?'Stops ahead of pace':'Stops behind pace',Math.abs(B.ahead)]]:[])]));
    if(B.netGainVal!=null) body.push(`<h3>Net gain</h3>`+rowsTable(['','Count','Annual $'],[['Recurring started',B.adds??'—',money(B.addVal)],['Cancelled',B.c,money(B.prod)],['<b>Net gain</b>',`<b>${B.adds!=null?fmt('netGain',B.adds-B.c):'—'}</b>`,`<b>${fmt('netGainVal',B.netGainVal)}</b>`]]));
    else if(B.netGain!=null) body.push(`<h3>Net change in setups</h3><p>${B.adds} recurring added − ${B.c} cancelled = <b>${fmt('netGain',B.netGain)}</b>.</p>`);
    if(R.base&&Object.keys(B.byClass).length){ const cls=R.base.branch.cls||{}; const keys=[...new Set([...Object.keys(B.byClass),...Object.keys(cls)])].sort();
      body.push(`<h3>By service class</h3>`+(B.classReady?'':'<p class="sub">Re-upload the Cancel Detail to split cancels by service class.</p>')+rowsTable(['Class','Started $','Cancelled $','Net gain $','Cancels','Cancel %'],
        keys.map(c=>{ const x=B.byClass[c]||{start:0,canc:0,cancN:0}, act=cls[c]?.annual||0, startBook=act+x.canc-x.start; return [esc(c),money(x.start),money(x.canc),fmt('netGainVal',x.start-x.canc),x.cancN||0,startBook>0&&B.classReady?pctG(x.canc/startBook*100,TARGET.cancel):'—']; })));
    }
    if(!ytd) body.push(`<h3>Counted in the branch total, not ranked</h3><p class="sub">${excludedNote(R)}</p>`);
  }
  return body;
}
function wireBody(el){
  wireLists(el);
  el.querySelectorAll('[data-tech]').forEach(b=>b.onclick=()=>{ $('#techDlg').close(); openTech(b.dataset.tech); });
  el.querySelectorAll('[data-sp]').forEach(b=>b.onclick=()=>{ $('#techDlg').close(); openSales(b.dataset.sp); });
  el.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{ removeSource(b.dataset.rm); });
  el.querySelectorAll('[data-rmbase]').forEach(b=>b.onclick=()=>{ removeBase(b.dataset.rmbase); });
}
function openBranch(sec){
  if(sec==='cancel') sec='route';
  const body=branchBody(sec); if(!body) return;
  body.push(sourcesBlock(true));
  $('#techTitle').textContent=`${LOCATION} branch · ${periodLabel()}`;
  $('#techBody').innerHTML=body.join('');
  wireBody($('#techBody'));
  $('#techDlg').showModal();
}
function ageBlock(t,label){
  const total=t.age.reduce((a,b)=>a+b,0); if(!total) return `<p class="sub">No cancellations for ${esc(label)} in this period.</p>`;
  const firstYr=t.age[0]/total*100;
  const bA=t.bAge&&t.bAge.some(x=>x)?t.bAge:null, bT=bA?bA.reduce((a,b)=>a+b,0):0;
  const share=i=>t.age[i]/total*100, bshare=i=>bA?bA[i]/bT*100:0;
  const mx=Math.max(...AGE.map((_,i)=>Math.max(share(i),bshare(i))),1);
  const compare=bA?` First-year customers are <span class="fig">${pct(bshare(0))}</span> of the active base today, so they cancel at about <b>${bshare(0)?(firstYr/bshare(0)).toFixed(1):'—'}×</b> their share.`:'';
  return `<p class="bigline"><span class="fig">${pct(firstYr)}</span> of ${esc(label)}’s cancellations were customers in their first year.${compare} Together these cancels took <span class="fig">${money(t.prod)}</span> in annual production.</p>
    ${bA?'<p class="sub"><span class="key key-c"></span> share of cancellations &nbsp; <span class="key key-b"></span> share of today’s active setups</p>':''}
    <div class="ages">${AGE.map((l,i)=>`<span class="lab">${l}</span><span class="track ${bA?'two':''}"><span class="bar ${i===0?'first':''}" style="width:${share(i)/mx*100}%"></span>${bA?`<span class="bar base" style="width:${bshare(i)/mx*100}%"></span>`:''}</span>
      <span class="val"><b>${t.age[i]}</b> · ${pct(share(i))} · ${money(t.ageProd[i])}${bA?`<br><span class="sub">${bA[i].toLocaleString()} active · ${pct(bshare(i))}</span>`:''}</span>`).join('')}</div>`;
}
function renderCancel(c){
  const R=compute(state.month,state.mode), Y=compute(state.month,'ytd');
  if(!R.has.cancel&&!Y.has.cancel){ c.innerHTML=`<div class="empty"><h2>No cancel detail yet</h2><p>Upload the cancel detail export to see cancellations by tech and month.</p>${state.canEdit===false?'':'<button class="btn" type="button" id="emptyUp">Upload reports</button>'}</div>${sourcesBlock()}`; return; }
  const months=Y.ms.filter(m=>m>=START_MONTH&&(state.months[m]?.cancel||state.months[m]?.routeCV));
  const v=state.cx.view, rows=[...Y.board].sort((a,b)=>(a.cByM[state.month]||0)-(b.cByM[state.month]||0)||a.display.localeCompare(b.display));
  const grp=(list,name)=>{ const g=blank({id:'g',display:name,status:'g'}); for(const t of list){ g.c+=t.c; for(const [m,n] of Object.entries(t.cByM)) g.cByM[m]=(g.cByM[m]||0)+n; } return g; };
  const groups=[]; if(Y.termed.length) groups.push(grp(Y.termed,'Termed employees')); const so=[...Y.main,...Y.staff,...Y.other]; if(so.length) groups.push(grp(so,'Main branch, staff and open routes'));
  const colMax={}; for(const m of months) colMax[m]=Math.max(...[...rows,...groups].map(t=>t.cByM[m]||0),1);
  const ytdMax=Math.max(...[...rows,...groups].map(t=>t.c),1);
  const cell=(t,m)=>{ const n=t.cByM[m]||0, tot=Y.B.cByM[m]||0; const a=Math.min(n/colMax[m],1)*0.7;
    return `<td class="cell ${m===state.month?'selcol':''}" style="--a:${a.toFixed(2)}">${v==='pct'?(tot?pct(n/tot*100):'—'):n}</td>`; };
  const ytd=t=>`<td class="cell ytd" style="--a:${(Math.min(t.c/ytdMax,1)*0.7).toFixed(2)}">${v==='pct'?(Y.B.c?pct(t.c/Y.B.c*100):'—'):t.c}</td>`;
  const scope=state.cx.who&&[...R.board,...R.termed,...R.staff,...R.other,...R.main].find(t=>t.id===state.cx.who)||R.B;
  const reasons=Object.entries(scope.reasons).sort((a,b)=>b[1]-a[1]).slice(0,8);
  c.innerHTML=`
    ${kpiStrip([
      ['Cancelled',(R.B.cancels??0).toLocaleString(),'setups · tap to see each',null,'cancel'],
      ...(R.B.cancelPct!=null?[['Cancel %',pctG(R.B.cancelPct,TARGET.cancel),R.B.cancelBasis==='dollars'?`${money(R.B.prod)} of ${money(R.B.bookStartVal)} active annual $ · goal ≤${TARGET.cancel}%`:`of ${R.B.stops.toLocaleString()} total stops · goal ≤${TARGET.cancel}%`,paceBadge('cancel',R.B.cancelPct,R.el),'cancel']]:[]),
      ['Production lost',money(R.B.prod),'annual value'],
      ...(R.B.age.reduce((a,b)=>a+b,0)?[['First-year customers',pct(R.B.age[0]/R.B.age.reduce((a,b)=>a+b,0)*100),'of cancellations']]:[])],'route')}
    ${(()=>{ const tot=R.B.age.reduce((a,b)=>a+b,0); if(tot<5) return ''; const fy=R.B.age[0]/tot*100; const bA=R.B.bAge, bs=bA?bA[0]/bA.reduce((a,b)=>a+b,0)*100:null; return bill(`${pct1(fy)} of this month’s cancels were first-year customers${bs?`, who make up only ${pct1(bs)} of our active setups`:''}. Hitting the target early in a customer’s first year is where routes are won.`); })()}
    <p class="periodline">${esc(periodLabel())} · termed employees, main branch, staff and open routes count in the branch total but aren’t ranked</p>
    <h3>Share of cancellations by tech</h3>
    <div class="toolrow"><div class="seg2" role="group" aria-label="Show"><button type="button" data-cxv="pct" aria-pressed="${v==='pct'}">% of branch</button><button type="button" data-cxv="count" aria-pressed="${v==='count'}">Count</button></div>
      <span class="sub">${v==='pct'?'Each cell is that tech’s share of the month’s branch cancellations.':'Number of accounts cancelled on each tech’s route.'}</span></div>
    <div class="heat"><table><thead><tr><th>Tech</th>${months.map(m=>`<th class="${m===state.month?'selcol':''}">${esc(monthName(m,true))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(t=>`<tr><td><button type="button" class="linkish" data-tech="${esc(t.id)}">${esc(t.display)}</button></td>${months.map(m=>cell(t,m)).join('')}</tr>`).join('')}
      ${groups.map(g=>`<tr class="grp"><td>${esc(g.display)}</td>${months.map(m=>cell(g,m)).join('')}</tr>`).join('')}
      <tr class="tot"><td>Branch total</td>${months.map(m=>`<td class="${m===state.month?'selcol':''}">${Y.B.cByM[m]||0}</td>`).join('')}</tr>
      ${Y.base?`<tr class="tot"><td>Branch cancel %</td>${months.map(m=>{ const sb=baseAtStart(m,Y.base); return `<td class="${m===state.month?'selcol':''}">${sb?pct((Y.B.cByM[m]||0)/sb*100):'—'}</td>`; }).join('')}</tr>`:''}</tbody></table></div>
    <p class="sub">The branch row always shows counts.${Y.base?' Branch cancel % divides each month’s cancels by the setups active at the start of that month, rebuilt from today’s customer list using the adds and cancels since.':''}</p>
    <h3>How long they’d been customers</h3>
    <div class="toolrow"><select id="cxWho" aria-label="Show for"><option value="">Whole branch</option>${sortList(R.board,'cancelShare','route').map(t=>`<option value="${esc(t.id)}" ${t.id===state.cx.who?'selected':''}>${esc(t.display)}</option>`).join('')}</select>
      <span class="sub">${state.mode==='month'?esc(monthName(state.month)):'Year to date'}</span></div>
    ${ageBlock(scope,scope.id==='branch'?'the branch':scope.display)}
    ${reasons.length?`<h3>Why they left</h3><div class="reasons">${reasons.map(([r,n])=>`<span>${esc(REASONS[r]||tc(r))}</span><span>${n}</span>`).join('')}</div>`:''}
    ${sourcesBlock()}`;
  c.querySelectorAll('[data-cxv]').forEach(b=>b.onclick=()=>{state.cx.view=b.dataset.cxv;render();});
  $('#cxWho').onchange=e=>{state.cx.who=e.target.value;render();};
}
const SRC={cancel:'Cancel detail',sales:'Sales details',route:'Route completion',open:'Open orders'};
function sourcesBlock(open){
  const ms=monthsIn(state.month,state.mode), lines=[];
  for(const m of ms){ const s=state.months[m]?.sources||{}; for(const [type,v] of Object.entries(s)){ if(type==='open'&&state.mode!=='month') continue;
    const id=m+':'+type; lines.push(`<span>${esc(monthName(m,true))} ${SRC[type]}: ${esc(v.file)}${v.at?`, uploaded ${esc(new Date(v.at).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}`:''} <span class="admin"><button type="button" data-rm="${id}">${state.arm===id?'tap again to remove':'remove'}</button></span></span>`); } }
  const b=latestBase(); let baseLine='<span>No customer list yet. Upload one to get true cancel percentages.</span>';
  if(b){ const c=b.checks;
    baseLine=`<span>Customer list ${esc(b.file)}, as of ${esc(b.asOf)}: ${c.rows.toLocaleString()} setups read, ${c.inactive.toLocaleString()} inactive or cancelled removed, ${c.dupSvcRows} repeated services removed, ${c.mergedLocs} customers with more than one location number combined. <span class="admin"><button type="button" data-rmbase="${esc(b.asOf)}">${state.arm==='base:'+b.asOf?'tap again to remove':'remove'}</button></span></span>
      <details class="checks"><summary>Show the duplicates that were removed (location numbers)</summary>
      ${c.dupList.length?`<p class="sub">Same service listed more than once at one customer. Counted once; the annual value of every copy is kept.</p><ul>${c.dupList.map(d=>`<li>Location ${esc(d.locs)}: ${esc(d.svc)} ×${d.extra+1}</li>`).join('')}</ul>`:''}
      ${c.mergedList.length?`<p class="sub">Different location numbers at the same address, counted as one customer.</p><ul>${c.mergedList.map(x=>`<li>Locations ${esc(x)}</li>`).join('')}</ul>`:''}</details>`; }
  const emp=state.roster.employeesFile?`<span>Employee list: ${esc(state.roster.employeesFile)} (${state.roster.employees?.length||0} ${LOCATION} employees)</span>`:'<span>No employment list yet, so termed employees are spotted only by the dates PestPac adds to their names.</span>';
  return open?`<h3>Data sources and checks</h3><div class="srcs sub">${baseLine}${emp}${lines.join('')}</div>`:`<details class="foot"><summary>Data sources and checks</summary><div class="srcs">${baseLine}${emp}${lines.join('')}</div></details>`;
}
async function removeBase(date){
  const id='base:'+date;
  if(state.arm!==id){ state.arm=id; render(); setTimeout(()=>{ if(state.arm===id){state.arm=null;render();} },4000); return; }
  state.arm=null;
  try{ if(state.db) await state.db.doc('base/'+date).delete(); delete state.bases[date]; render(); }catch(e){ alert('Couldn’t remove the customer list.'); }
}
async function removeSource(id){
  if(state.arm!==id){ state.arm=id; render(); setTimeout(()=>{ if(state.arm===id){state.arm=null;render();} },4000); return; }
  state.arm=null; const [m,type]=id.split(':');
  const d=JSON.parse(JSON.stringify(state.months[m]||{})); delete d[type]; if(d.sources) delete d.sources[type];
  try{
    const empty=!['cancel','sales','route','open'].some(k=>d[k]);
    if(state.db){ if(empty) await state.db.doc('months/'+m).delete(); else await state.db.doc('months/'+m).set(d); }
    if(empty) delete state.months[m]; else state.months[m]=d; render();
  }catch(e){ alert('Couldn’t remove that report.'); }
}

/* ---------- sales budgets: helpers ---------- */
function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function goalMonths(month,mode){ if(mode==='month') return [month]; const y=month.slice(0,4), n=+month.slice(5); return Array.from({length:n},(_,i)=>y+'-'+pad(i+1)); }
// Share of the month's Mon–Fri workdays covered by the sales data (through the latest invoice date in the upload),
// so pace isn't penalized when the board is viewed a few days after the last upload. Same rule as route pacing.
function expectedFor(m){ const now=todayStr(); if(m<now.slice(0,7)) return 1; if(m>now.slice(0,7)) return 0;
  const a=state.months[m]?.sources?.sales?.asOf; return workdayShare(m,a&&a.slice(0,7)===m?a:now); }
function salesStatus(r){
  if(r.status==='main') return 'main';
  if(r.status==='other') return 'other';
  if(hasAnyBudget(r.id)) return 'board';
  if(r.emp&&/sales/i.test(r.emp.dept)) return 'board';
  if(r.emp) return 'staff';
  return state.roster.termedSeen?.[r.key]?'termed':'outside';
}
function sblank(id,display,status,emp){ return {id,display,status,emp,rec:0,recVal:0,recTotal:0,ot:0,otRev:0,ex:0,early:0,spc:0,byM:{}}; }
// Branch sales against the Power BI DOR budget, for the months that budget covers
// Monthly sales budget from the FY budget plan (Sales Trend Tracker), as a DOR-shaped entry
function planBudget(months){
  let total={budget:0,recBudget:0,otBudget:0}, ok=false;
  for(const m of months){ const b=state.roster.plans?.[m.slice(0,4)]?.budget?.[BRANCH]?.[m]; if(!b) return null; ok=true; total.budget+=b.total; total.recBudget+=b.rec; total.otBudget+=b.ot; }
  return ok?{months,total,byClass:{},file:'FY budget plan'}:null;
}
function dorCompare(month,mode){
  const D=state.roster.dor||{}, cur=curYM();
  let e;
  if(mode==='month') e=planBudget([month])||D[month];
  else { const ms=goalMonths(month,'ytd').filter(m=>m<cur); e=(ms.length&&planBudget(ms))||D.ytd; }
  if(!e) return mode==='month'&&month===cur&&D.ytd?{missing:'month',month}:null;
  if(mode==='ytd'&&e.file!=='FY budget plan'&&e.months.includes(cur)){
    // the export includes the month under way: remove that month's budget so year to date is closed months only
    const cm=D[cur];
    if(!cm) return {missing:'subtract',month:cur};
    const sub=(a,b)=>{ const o={}; for(const k in a) o[k]=(a[k]||0)-((b&&b[k])||0); return o; };
    const byClass={}; for(const [c,v] of Object.entries(e.byClass||{})) byClass[c]=sub(v,cm.byClass?.[c]);
    e={...e,months:e.months.filter(m=>m!==cur),total:sub(e.total,cm.total),byClass};
  }
  const cap={total:0,rec:0,ot:0}, byClass={};
  for(const m of e.months){ const d=state.months[m]; if(!d) continue;
    if(d.salesClass) for(const [c,v] of Object.entries(d.salesClass)){ cap.total+=v.total; cap.rec+=v.rec; cap.ot+=v.ot+v.ex; const b=byClass[c]||(byClass[c]={cap:0}); b.cap+=v.total; }
    else if(d.sales) for(const v of Object.values(d.sales)){ cap.rec+=v.recVal||0; cap.ot+=(v.otRev||0)+(v.ex||0); cap.total+=(v.recVal||0)+(v.otRev||0)+(v.ex||0); } }
  for(const [c,b] of Object.entries(e.byClass||{})){ const x=byClass[c]||(byClass[c]={cap:0}); x.budget=b.budget; }
  const exp=avg(e.months.map(expectedFor))??1;
  return {months:e.months,file:e.file,budget:e.total.budget,recBudget:e.total.recBudget,otBudget:e.total.otBudget,cap,byClass,exp,
    pct:e.total.budget?cap.total/e.total.budget*100:null,recPct:e.total.recBudget?cap.rec/e.total.recBudget*100:null,otPct:e.total.otBudget?cap.ot/e.total.otBudget*100:null,
    needsResync:e.months.some(m=>state.months[m]?.sales&&!state.months[m].salesClass)};
}
/* ---------- monthly sales budgets ---------- */
// roster.budgets = { 'YYYY-MM': { personId: { name, rec, ot } } }  (dollars; recurring = annual value)
function budgetFor(id,m){ return state.roster.budgets?.[m]?.[id]||null; }
function hasAnyBudget(id){ return Object.values(state.roster.budgets||{}).some(b=>b&&b[id]); }
const curYM=()=>todayStr().slice(0,7);
function computeSales(month,mode){
  // Year to date covers closed months only; the month under way is tracked on its own, on pace / off pace
  const gm=goalMonths(month,mode).filter(m=>mode==='month'||m<curYM());
  const withData=gm.filter(m=>state.months[m]?.sales);
  if(!withData.length) return null;
  const stale=withData.some(m=>state.months[m].sources?.sales?.by!=='salesperson');
  const P={};
  for(const m of withData){
    for(const [k,v] of Object.entries(state.months[m].sales)){
      const r=resolveKey(k), st=salesStatus(r);
      const t=P[r.id]||(P[r.id]=sblank(r.id,r.display,st,r.emp));
      const bm=t.byM[m]||(t.byM[m]={rec:0,recVal:0,ot:0,otRev:0,ex:0});
      for(const f of ['rec','recVal','recTotal','ot','otRev','ex']) t[f]+=v[f]||0;
      for(const f of ['rec','recVal','ot','otRev','ex']) bm[f]+=v[f]||0;
    }
  }
  // Backlog (sold, not completed yet) for the month under way is counted in each salesperson's totals.
  // t.pend keeps the pending part so bars can draw it dashed.
  if(mode==='month'){ const bl=backlogFor(month);
    if(bl) for(const [k,v] of Object.entries(bl.bySp||{})){ const r=resolveKey(k), st=salesStatus(r);
      const t=P[r.id]||(P[r.id]=sblank(r.id,r.display,st,r.emp)), bm=t.byM[month]||(t.byM[month]={rec:0,recVal:0,ot:0,otRev:0,ex:0});
      t.pend=t.pend||{total:0,rec:0,ot:0}; t.pend.total+=v.total; t.pend.rec+=v.rec; t.pend.ot+=v.ot;
      t.recVal+=v.rec; t.otRev+=v.ot; bm.recVal+=v.rec; bm.otRev+=v.ot; } }
  // Sale quality (chargebacks): first-year cancels on each salesperson's accounts. Used only in the sales score;
  // cancellations are never subtracted from captured sales dollars.
  let hasQ=false;
  for(const m of gm){ const sc=state.months[m]?.spCancel; if(!sc) continue; hasQ=true;
    for(const [k,v] of Object.entries(sc)){ const r=resolveKey(k), st=salesStatus(r); const t=P[r.id]||(P[r.id]=sblank(r.id,r.display,st,r.emp)); t.early+=v.early||0; t.spc+=v.n||0; } }
  // anyone with a budget in these months gets a row, even before their first sale
  const budMonths=gm.filter(m=>state.roster.budgets?.[m]&&Object.keys(state.roster.budgets[m]).length);
  for(const m of budMonths) for(const [id,b] of Object.entries(state.roster.budgets[m])) if(!P[id]) P[id]=sblank(id,b.name||id,'board',null);
  // how far through the budgeted period we are (a closed month counts as 1)
  const exp=avg((budMonths.length?budMonths:gm).map(expectedFor))??1;
  const derive=t=>{
    t.recAmt=t.recVal;
    let rg=0,og=0,rc=0,oc=0;
    for(const m of gm){ const b=budgetFor(t.id,m); if(!b) continue; const a=t.byM[m]||{recVal:0,otRev:0,ex:0};
      if(b.rec){ rg+=b.rec; rc+=a.recVal; } if(b.ot){ og+=b.ot; oc+=a.otRev+(a.ex||0); } }
    t.recGoal=rg||null; t.otGoal=og||null; t.recCap=rc; t.otCap=oc;
    t.recPct=t.recGoal?rc/rg*100:null; t.otPct=t.otGoal?oc/og*100:null;
    t.budget=(rg+og)||null; t.captured=rc+oc;
    t.goalPct=t.budget?t.captured/t.budget*100:null;
    // Overall = recurring annual value + one-time sales; in a month still under way, projected to month end at the current pace
    t.otAll=(t.otRev||0)+(t.ex||0); // one-time + excess initial, as the DOR groups them
    t.overall=(t.recVal||0)+t.otAll;
    // projection: completed sales at the current pace, but never less than completed + backlog already in hand
    const done=t.overall-(t.pend?.total||0);
    t.proj=mode==='month'&&exp>0&&exp<1?Math.max(done/exp,t.overall):t.overall;
  };
  const all=Object.values(P); all.forEach(derive);
  const B=sblank('branch','Branch total','branch',null);
  for(const t of all) for(const f of ['rec','recVal','recTotal','ot','otRev','ex','early','spc']) B[f]+=t[f];
  B.pend={total:0,rec:0,ot:0}; for(const t of all) if(t.pend) for(const f of ['total','rec','ot']) B.pend[f]+=t.pend[f];
  B.otAll=B.otRev+B.ex;
  // Sales score (100): 40 total dollars vs budget, 25 recurring vs budget, 20 one-time & initial vs budget (all against pace), 15 sale quality
  const branchEarly=B.rec?B.early/B.rec:0, ep=Math.max(exp,0.01);
  for(const t of all){
    const parts=[];
    if(t.budget) parts.push([40,Math.min(t.goalPct/(ep*100),1)]);
    if(t.recGoal) parts.push([25,Math.min(t.recPct/(ep*100),1)]);
    if(t.otGoal) parts.push([20,Math.min(t.otPct/(ep*100),1)]);
    t.earlyRate=hasQ&&t.rec?t.early/t.rec:null;
    t.quality=hasQ&&parts.length&&t.rec?(t.early===0?1:Math.min(1,branchEarly/(t.early/t.rec))):null; // quality points only once they've sold something
    if(t.quality!=null) parts.push([15,t.quality]);
    t.score=parts.length&&(t.recGoal||t.otGoal)?Math.round(100*parts.reduce((a,[w,v])=>a+w*v,0)/parts.reduce((a,[w])=>a+w,0)):null;
    t.scoreParts=parts;
  }
  // branch: everyone's budgets added up, against what those same people captured in those months
  B.recAmt=B.recVal;
  B.recGoal=all.reduce((a,t)=>a+(t.recGoal||0),0)||null; B.otGoal=all.reduce((a,t)=>a+(t.otGoal||0),0)||null;
  B.gRec=all.reduce((a,t)=>a+(t.recGoal?t.recCap:0),0); B.gOt=all.reduce((a,t)=>a+(t.otGoal?t.otCap:0),0);
  B.gPend=all.reduce((a,t)=>a+(t.budget&&t.pend?t.pend.total:0),0);
  B.recPct=B.recGoal?B.gRec/B.recGoal*100:null; B.otPct=B.otGoal?B.gOt/B.otGoal*100:null;
  B.budget=(B.recGoal||0)+(B.otGoal||0)||null; B.captured=B.gRec+B.gOt; B.goalPct=B.budget?B.captured/B.budget*100:null;
  B.overall=B.recVal+B.otAll; B.proj=mode==='month'&&exp>0&&exp<1?Math.max((B.overall-B.pend.total)/exp,B.overall):B.overall;
  const cancels=null; // cancellations belong to the route views, not sales
  const by=s=>all.filter(t=>t.status===s);
  return {board:by('board'),termed:by('termed'),outside:by('outside'),staff:by('staff'),main:by('main'),other:by('other'),B,exp,n:gm.length,budMonths,unit:'value',stale,cancels,hasGoals:budMonths.length>0,dor:dorCompare(month,mode)};
}
// Backlog (pending sales) for a month, only from a recent snapshot of that month
function backlogFor(month){ const b=state.roster.backlog; if(!b||month!==curYM()) return null; const m=b.months?.[month]; return m&&m.total>0?{...m,asOf:b.asOf,file:b.file}:null; }
function backlogLater(month){ const b=state.roster.backlog; if(!b) return 0; return Object.entries(b.months||{}).filter(([m])=>m>month&&m.slice(0,4)===month.slice(0,4)).reduce((a,[,v])=>a+v.total,0); }
function backlogBySp(month){ const bl=backlogFor(month), out={}; if(!bl) return out; for(const [k,v] of Object.entries(bl.bySp||{})){ const id=resolveKey(k).id, o=out[id]||(out[id]={total:0,rec:0,ot:0,n:0}); for(const f of ['total','rec','ot','n']) o[f]+=v[f]; } return out; }
const MAYBE='<span class="pb maybe">PENDING</span>';
function dorTile(D,pend){
  if(D&&D.missing) return [['Branch vs. budget','—',D.missing==='month'?`upload ${monthName(D.month,true)}’s DOR budget (filtered to that month) to track it`:`upload ${monthName(D.month,true)}’s DOR budget so it can be taken out of year to date`]];
  if(!D||D.pct==null) return [];
  pend=pend>0?pend:0;
  const span=D.months.length===1?monthName(D.months[0],true):`${monthName(D.months[0],true)}–${monthName(D.months[D.months.length-1],true)}`;
  const tot=D.cap.total+pend, pctT=D.budget?tot/D.budget*100:D.pct;
  const ok=pctT>=D.exp*100, done=D.exp>=1;
  return [['Branch vs. budget',pct1(pctT),`${money(tot)} of ${money(D.budget)} · ${span}${pend?` · <span class="pend">incl. ${money(pend)} pending</span>`:''}`,`<span class="pb ${ok?'ok':'no'}">${done?(pctT>=100?'BUDGET MET':'BUDGET MISSED'):(ok?'ON PACE':'OFF PACE')}</span>`,null,null,pend?miniBar(D.cap.total/D.budget*100,pend/D.budget*100):'']];
}
function dorHTML(D){
  if(!D) return '';
  if(D.missing) return `<h3>Branch vs. DOR sales budget</h3><p class="sub">${D.missing==='month'?`To track ${esc(monthName(D.month))} on pace, export the DOR sales budget filtered to that month only and upload it.`:`The DOR file includes ${esc(monthName(D.month))}, which is still under way. Upload ${esc(monthName(D.month))}’s DOR budget on its own (filtered to that month) and year to date will exclude it automatically. Or export the year-to-date budget without the current month.`}</p>`;
  const span=D.months.length===1?monthName(D.months[0]):`${monthName(D.months[0])} – ${monthName(D.months[D.months.length-1])}`;
  const rows=Object.entries(D.byClass).filter(([c,v])=>(v.budget||0)>0||(v.cap||0)>0).sort((a,b)=>(b[1].budget||0)-(a[1].budget||0))
    .map(([c,v])=>[esc(c),money(v.cap),money(v.budget||0),v.budget?pct1(v.cap/v.budget*100):'—']);
  rows.push(['<b>Total</b>',`<b>${money(D.cap.total)}</b>`,`<b>${money(D.budget)}</b>`,`<b>${pct1(D.pct)}</b>`]);
  return `<h3>Branch vs. DOR sales budget</h3>
    <p class="sub">${esc(span)}, from ${esc(D.file||'the DOR export')}. Captured is total sales from the Sales Details report (recurring annual value + one-time + excess initial), the same way the DOR adds it up.</p>
    ${rowsTable(['Service class','Captured','Budget','%'],rows)}
    ${rowsTable(['','Captured','Budget','%'],[['Recurring',money(D.cap.rec),money(D.recBudget),D.recPct!=null?pct1(D.recPct):'—'],['One-time & initial',money(D.cap.ot),money(D.otBudget),D.otPct!=null?pct1(D.otPct):'—']])}
    ${D.needsResync?'<p class="sub" style="color:var(--low)">Re-upload the Sales Details export so excess initial and service-class totals are included for every month.</p>':''}`;
}
function goalBand(pct,exp){ if(pct==null) return 'c-none'; const r=exp>0?pct/(exp*100):1; return r>=1?'c-good':r>=0.8?'c-mid':'c-low'; }
// amt already includes any pending backlog; pend is drawn as the dashed part at the end of the bar
function goalBar(label,amt,goal,pctV,exp,isMoney,pend){
  pend=pend>0?Math.min(pend,amt):0;
  const a=isMoney?money(amt):Math.round(amt).toLocaleString();
  const pTxt=pend>0?` <span class="pend">incl. ${money(pend)} pending</span>`:'';
  if(goal==null) return `<span class="gb c-none"><span class="gbl">${label}</span><span class="gbt"></span><span class="gbv">${a} · no budget${pTxt}</span></span>`;
  const g=isMoney?money(goal):Math.round(goal).toLocaleString();
  const total=Math.min(pctV,100), dash=pend>0?Math.min(pend/goal*100,total):0, solid=total-dash;
  return `<span class="gb ${goalBand(pctV,exp)}"><span class="gbl">${label}</span><span class="gbt"><span class="gbf" style="width:${solid}%"></span>${dash>0?`<span class="gbp" style="left:${solid}%;width:${dash}%" title="Pending backlog: sold but not completed yet. It may still cancel or move to next month."></span>`:''}${exp<1?`<span class="gbx" style="left:${exp*100}%"></span>`:''}</span><span class="gbv"><b>${pct(pctV)}</b> · ${a} of ${g} budget${pTxt}</span></span>`;
}
// small solid + dashed bar for a tile (completed vs pending share of a target)
function miniBar(solidPct,dashPct){ const s1=Math.max(0,Math.min(solidPct,100)), d1=Math.max(0,Math.min(dashPct,100-s1)); return `<span class="kbar"><span class="kbf" style="width:${s1}%"></span>${d1>0?`<span class="kbp" style="left:${s1}%;width:${d1}%"></span>`:''}</span>`; }
function renderSales(c){
  const S=computeSales(state.month,state.mode);
  const BL=state.mode==='month'?backlogFor(state.month):null;
  const goalsBtn=state.canEdit===false?'':`<button type="button" class="ghost admin" id="goalsBtn">Sales budgets</button>`;
  if(!S){ c.innerHTML=`<div class="empty"><h2>No sales details for ${esc(periodLabel())}</h2><p>Upload the sales details export covering this period.</p>${state.canEdit===false?'':'<button class="btn" type="button" id="emptyUp">Upload reports</button>'}</div>${sourcesBlock()}`; return; }
  const B=S.B, isVal=S.unit!=='accounts';
  const projecting=state.mode==='month'&&S.exp>0&&S.exp<1;
  const sorts=SORTS.sales.map(x=>x.key==='recAmt'?{...x,label:isVal?'Recurring annual $':'Recurring accounts'}:x.key==='proj'?{...x,label:projecting?'Overall (projected)':'Overall'}:x)
    .filter(x=>S.board.some(t=>t[x.key]!=null)&&(S.hasGoals||!/Pct$/.test(x.key)));
  const sk=sorts.some(x=>x.key===state.sort.sales)?state.sort.sales:(sorts[0]?.key||'recAmt');
  const bits=[`<span class="fig">${B.rec}</span> recurring sales worth ${money(B.recVal)} a year`,`<span class="fig">${money(B.otAll)}</span> in one-time & initial sales`];
  const net=S.cancels!=null?` Net change in setups: <span class="fig">${B.rec-S.cancels>0?'+':''}${B.rec-S.cancels}</span> (${B.rec} added, ${S.cancels} cancelled).`:'';
  const names=l=>l.map(t=>`<button type="button" class="linkish" data-sp="${esc(t.id)}">${esc(t.display)}</button>`).join(', ');
  const parts=[];
  if(S.main.length) parts.push(`main branch (${names(S.main)})`);
  if(S.staff.length) parts.push(`techs and staff without a goal (${names(S.staff)})`);
  if(S.outside.length) parts.push(`salespeople not on the ${LOCATION} list, such as inside sales (${names(S.outside)})`);
  if(S.termed.length) parts.push(`termed (${names(S.termed)})`);
  if(S.other.length) parts.push(`other (${names(S.other)})`);
  const expTxt=S.exp<1?`The black mark on each bar is where they should be today (${pct(S.exp*100)} of the ${state.mode==='month'?'month':'year so far'}’s goal).`:'';
  const rows=sortList(S.board,sk,'sales');
  c.innerHTML=`
    ${S.stale?'<p class="banner" style="border-radius:8px">Some months were uploaded before sales were credited to salespeople. Re-upload the sales details export to fix them.</p>':''}
    ${kpiStrip([
      ...dorTile(S.dor,BL?.total),
      ...(S.hasGoals?[['Salespeople vs. budget',B.goalPct!=null?pct1(B.goalPct):'—',`${money(B.captured)} of ${money(B.budget)} budgeted${B.gPend?` · <span class="pend">incl. ${money(B.gPend)} pending</span>`:''}`,B.goalPct!=null?`<span class="pb ${B.goalPct>=S.exp*100?'ok':'no'}">${S.exp>=1?(B.goalPct>=100?'BUDGET MET':'BUDGET MISSED'):(B.goalPct>=S.exp*100?'ON PACE':'OFF PACE')}</span>`:'']]:[]),
      ['Recurring sold',money(B.recVal),`${B.rec} setups${B.recPct!=null?` · ${pct1(B.recPct)} of budget`:''}${B.pend.rec?` · <span class="pend">incl. ${money(B.pend.rec)} pending</span>`:''}`,'',null,null,B.pend.rec?miniBar((B.recVal-B.pend.rec)/B.recVal*100,B.pend.rec/B.recVal*100):''],
      ['One-time & initial',money(B.otAll),`${B.ot} jobs + initial${B.otPct!=null?` · ${pct1(B.otPct)} of budget`:''}${B.pend.ot?` · <span class="pend">incl. ${money(B.pend.ot)} pending</span>`:''}`,'',null,null,B.pend.ot?miniBar((B.otAll-B.pend.ot)/B.otAll*100,B.pend.ot/B.otAll*100):''],
      ...(S.cancels!=null?[['Net setups',fmt('netGain',B.rec-S.cancels),`${B.rec} added · ${S.cancels} cancelled`]]:[])],'sales')}
    ${S.hasGoals&&B.goalPct!=null?bill(B.goalPct>=S.exp*100?`The sales team has captured ${pct1(B.goalPct)} of budget, right where it should be by now. Keep stacking setups.`:`The sales team has captured ${pct1(B.goalPct)} of budget; about ${pct1(S.exp*100)} would be on pace by today.`):''}
    <p class="periodline">${esc(periodLabel())} · credit goes to the salesperson on each sale${S.exp<1?' · the black mark on each bar is where they should be today':''}</p>
    ${sk==='score'?'<p class="hint">Sales score out of 100: 40 points for total dollars captured against budget (recurring, one-time and initial combined), 25 for recurring against budget, 20 for one-time & initial against budget (all measured against where they should be by today), and 15 for sale quality: keeping first-year cancellations (chargebacks) at or below the branch rate. Cancellations are never subtracted from captured sales.</p>':''}
    <div class="toolrow">${goalsBtn}${!S.hasGoals?'<span class="sub">No budget for this month yet. Add one to track captured sales against budgeted dollars.</span>':''}</div>
    <nav class="tabs" aria-label="Rank by">${sorts.map(x=>`<button type="button" data-sort="${x.key}" aria-pressed="${x.key===sk}">${x.label}</button>`).join('')}</nav>
    ${sk==='proj'?`<p class="hint">Overall is recurring annual value plus one-time sales${projecting?`, projected to month end at the current pace (${pct1(S.exp*100)} of the month’s workdays are done)`:''}. Ranked best to worst.</p>`:''}
    <button type="button" class="branch" data-branch="sales"><span class="who"><span class="name">Branch total</span>
      <span class="chips"><span><b>${B.rec}</b> recurring</span><span><b>${money(B.recVal)}</b>/yr</span><span><b>${money(B.otAll)}</b> one-time & initial</span></span></span>
      <span class="score">${sk==='proj'?`<span class="num">${money(B.proj)}</span>`:''}<span class="more">Details ›</span></span></button>
    <ol class="board">${rows.map((t,i)=>{
      const big=sk==='score'?(t.score??'—'):fmt(sk,t[sk]);
      return `<li><button type="button" class="lane ${goalBand(t.goalPct,S.exp)}" data-sp="${esc(t.id)}">
        <span class="rank">${t[sk]==null?'–':i+1}</span>
        <span class="who"><span class="name">${esc(t.display)}</span><span class="chips">${t.goalPct!=null?`<span>${S.exp>=1?`<span class="pb ${t.goalPct>=100?'ok':'no'}">${t.goalPct>=100?'BUDGET MET':'BUDGET MISSED'}</span>`:`<span class="pb ${t.goalPct>=S.exp*100?'ok':'no'}">${t.goalPct>=S.exp*100?'ON PACE':'OFF PACE'}</span>`}</span>`:''}${sk==='proj'&&projecting?`<span><b>${money(t.overall)}</b> so far${t.pend?` <span class="pend">(incl. ${money(t.pend.total)} pending)</span>`:''}</span>`:''}${sk!=='score'&&t.score!=null?`<span>score <b>${t.score}</b></span>`:''}<span><b>${t.rec}</b> recurring</span><span><b>${money(t.recVal)}</b>/yr</span><span><b>${t.ot}</b> one-time</span>${t.earlyRate!=null?`<span><b>${t.early}</b> first-year cancels</span>`:''}</span></span>
        <span class="score"><span class="num">${big}</span></span>
        <span class="goals">${goalBar('Total',t.budget?t.captured:t.overall,t.budget,t.goalPct,S.exp,true,t.pend?.total)}${goalBar('Recurring',t.recGoal?t.recCap:t.recAmt,t.recGoal,t.recPct,S.exp,true,t.pend?.rec)}${goalBar('One-time & initial',t.otGoal?t.otCap:t.otAll,t.otGoal,t.otPct,S.exp,true,t.pend?.ot)}</span></button></li>`;
    }).join('')}</ol>${sourcesBlock()}`;
  c.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{state.sort.sales=b.dataset.sort;render();});
}
function openSales(id){
  const Y=computeSales(curMonth(),'ytd'); if(!Y) return;
  const t=[...Y.board,...Y.termed,...Y.outside,...Y.staff,...Y.main,...Y.other].find(x=>x.id===id); if(!t) return;
  const ms=goalMonths(curMonth(),'ytd').filter(m=>m>=START_MONTH||budgetFor(id,m));
  const cell=(a,b)=>b?`${money(a)} <span class="sub">of ${money(b)}</span>`:money(a);
  const pc=(a,b)=>b?pct1(a/b*100):'—';
  $('#techTitle').innerHTML=esc(t.display)+(t.status==='board'?'':`<span class="statusTag">${{main:'Main branch',staff:'No budget',outside:`Not on ${LOCATION} list`,termed:'Termed',other:'Other'}[t.status]}</span>`);
  const P=computeSales(curMonth(),state.mode); const x=P&&[...P.board,...P.termed,...P.outside,...P.staff,...P.main,...P.other].find(y=>y.id===id);
  const lbl=['Total dollars vs budget','Recurring vs budget','One-time & initial vs budget','Sale quality'], ws=[40,25,20,15];
  $('#techBody').innerHTML=`
    ${x&&x.score!=null?`<div class="big ${x.score>=80?'c-good':x.score>=60?'c-mid':'c-low'}"><span class="num">${x.score}</span><span class="lab">sales score, ${esc(periodLabel())}</span></div>
      <p class="sub">${x.scoreParts.map(([w,v])=>`${lbl[ws.indexOf(w)]}: ${Math.round(w*v)} of ${w}`).join(' · ')}${x.earlyRate!=null?` · ${x.early} first-year cancels on ${x.rec} recurring sales`:''}</p>`:''}
    <h3>Captured vs. budget by month</h3>
    <div class="tbl"><table><thead><tr><th>Month</th><th>Recurring captured</th><th>%</th><th>One-time & initial</th><th>%</th><th>Total</th><th>%</th></tr></thead><tbody>
    ${ms.map(m=>{ const a0=t.byM[m]||{rec:0,recVal:0,ot:0,otRev:0,ex:0}, a={...a0,otRev:(a0.otRev||0)+(a0.ex||0)}, b=budgetFor(id,m)||{}; const tb=(b.rec||0)+(b.ot||0);
      return `<tr><td>${esc(monthName(m,true))}</td><td>${cell(a.recVal,b.rec)}</td><td>${pc(a.recVal,b.rec)}</td><td>${cell(a.otRev,b.ot)}</td><td>${pc(a.otRev,b.ot)}</td><td>${cell(a.recVal+a.otRev,tb)}</td><td>${pc(a.recVal+a.otRev,tb)}</td></tr>`; }).join('')}
    <tr class="tot"><td>YTD (budgeted months)</td><td>${cell(t.recCap,t.recGoal)}</td><td>${t.recPct!=null?pct1(t.recPct):'—'}</td><td>${cell(t.otCap,t.otGoal)}</td><td>${t.otPct!=null?pct1(t.otPct):'—'}</td><td>${cell(t.captured,t.budget)}</td><td>${t.goalPct!=null?pct1(t.goalPct):'—'}</td></tr>
    </tbody></table></div>
    <p class="sub">Recurring is captured as annual value. Year to date compares only the months that have a budget.</p>
    ${state.canEdit===false?'':'<div class="actions admin"><button type="button" class="ghost" id="editGoal">Edit budgets</button></div>'}`;
  $('#editGoal')?.addEventListener('click',()=>{ $('#techDlg').close(); openGoals(); });
  $('#techDlg').showModal();
}
function openGoals(month){
  const cur=month||curMonth()||todayStr().slice(0,7), y=cur.slice(0,4);
  const months=Array.from({length:12},(_,i)=>y+'-'+pad(i+1));
  const bud=(state.roster.budgets||{})[cur]||{};
  const S=computeSales(cur,'ytd'), people={};
  for(const t of S?[...S.board,...S.staff,...S.outside,...S.termed]:[]) people[t.id]={id:t.id,name:t.display,status:t.status,ytd:t.recVal+t.otAll};
  for(const e of state.roster.employees||[]){ const id='e'+e.id; if(!people[id]&&/sales/i.test(e.dept)) people[id]={id,name:e.first+' '+e.last,status:'board',ytd:0}; }
  for(const mb of Object.values(state.roster.budgets||{})) for(const [id,b] of Object.entries(mb||{})) if(!people[id]) people[id]={id,name:b.name||id,status:'board',ytd:0};
  const order={board:0,staff:1,outside:2,termed:3};
  const list=Object.values(people).sort((a,b)=>(bud[b.id]?1:0)-(bud[a.id]?1:0)||order[a.status]-order[b.status]||b.ytd-a.ytd);
  const prevM=months[months.indexOf(cur)-1], prev=prevM&&state.roster.budgets?.[prevM];
  $('#goalTitle').textContent='Sales budgets';
  $('#goalBody').innerHTML=`
    <div class="toolrow"><label>Month <select id="budMonth">${months.map(m=>`<option value="${m}" ${m===cur?'selected':''}>${esc(monthName(m))}${state.roster.budgets?.[m]&&Object.keys(state.roster.budgets[m]).length?' ✓':''}</option>`).join('')}</select></label>
      ${prev&&Object.keys(prev).length?`<button type="button" class="ghost" id="copyPrev">Copy ${esc(monthName(prevM,true))}’s budgets</button>`:''}</div>
    <p class="sub">Budgeted sales dollars for ${esc(monthName(cur))}. Recurring is annual value; one-time is the sale amount. Leave both blank for anyone without a budget this month. ${LOCATION} outside sales show on the board either way.</p>
    <div class="tbl"><table><thead><tr><th>Salesperson</th><th>Recurring $</th><th>One-time $</th></tr></thead><tbody>
    ${list.map(p=>`<tr><td>${esc(p.name)}${p.status==='staff'?'<span class="statusTag">tech/staff</span>':p.status==='outside'?`<span class="statusTag">not ${LOCATION}</span>`:p.status==='termed'?'<span class="statusTag">termed</span>':''}<br><span class="sub">${money(p.ytd)} sold YTD</span></td>
      <td><input type="number" inputmode="decimal" min="0" step="any" data-g="rec" data-id="${esc(p.id)}" data-name="${esc(p.name)}" value="${bud[p.id]?.rec||''}" aria-label="${esc(p.name)} recurring budget" style="width:7.5rem"></td>
      <td><input type="number" inputmode="decimal" min="0" step="any" data-g="ot" data-id="${esc(p.id)}" value="${bud[p.id]?.ot||''}" aria-label="${esc(p.name)} one-time budget" style="width:7.5rem"></td></tr>`).join('')}
    </tbody></table></div>
    <div class="actions"><button type="button" class="go" id="saveGoals">Save ${esc(monthName(cur,true))} budgets</button><span class="status" id="goalStatus"></span></div>`;
  $('#budMonth').onchange=e=>openGoals(e.target.value);
  $('#copyPrev')?.addEventListener('click',()=>{ $('#goalBody').querySelectorAll('input[data-g]').forEach(inp=>{ const b=prev[inp.dataset.id]; if(b) inp.value=b[inp.dataset.g]||''; }); });
  $('#saveGoals').onclick=async()=>{
    const g={};
    $('#goalBody').querySelectorAll('input[data-g="rec"]').forEach(inp=>{
      const id=inp.dataset.id, ot=[...$('#goalBody').querySelectorAll('input[data-g="ot"]')].find(x=>x.dataset.id===id);
      const rv=parseFloat(inp.value), ov=parseFloat(ot.value);
      if(rv>0||ov>0) g[id]={name:inp.dataset.name,rec:rv>0?rv:0,ot:ov>0?ov:0};
    });
    const r=JSON.parse(JSON.stringify(state.roster)); r.budgets=r.budgets||{};
    if(Object.keys(g).length) r.budgets[cur]=g; else delete r.budgets[cur];
    state.roster=r; markDirty(); render(); $('#goalDlg').close();
  };
  if(!$('#goalDlg').open) $('#goalDlg').showModal();
}
/* ---------- cancel and void line items (month board) ---------- */
function lineItems(month){
  const d=state.months[month]||{}, R=compute(month,'month');
  const cname={}; for(const md of Object.values(state.months)) for(const x of md.cancelList||[]) if(x.n&&!cname[x.l]) cname[x.l]=x.n;
  const nameOf=l=>cname[l]||state.locnames?.[l]||'';
  const who=k=>{ const r=resolveKey(k); return {id:r.id,who:r.display}; };
  const cancels=(d.cancelList||[]).map(x=>({...x,...who(x.k),n:x.n||nameOf(x.l),reason:REASONS[x.r]||tc(x.r)}));
  if(R) for(const u of R.cross.unmatched) if(u.m===month) cancels.push({l:u.loc,s:u.svc,d:'',...who(u.k),n:nameOf(u.loc),reason:'Canceled (route report, not yet in cancel detail)'});
  const voids=(d.voidList||[]).map(x=>({...x,...who(x.k),n:nameOf(x.l),reason:VOID_LBL[x.r]||tc(x.r)}));
  const rolled={}; // CANCELED voids that are already in the cancel report, rolled up per person
  const unm=new Set((R?.cross.unmatched||[]).filter(u=>u.m===month).map(u=>u.k+'|'+u.loc+'|'+u.svc));
  for(const x of d.routeCV||[]){ if(unm.has(x.k+'|'+x.loc+'|'+x.svc)) continue; const id=who(x.k).id; rolled[id]=(rolled[id]||0)+1; rolled.branch=(rolled.branch||0)+1; }
  return {cancels,voids,rolled,hasCancelLines:!!d.cancelList,hasVoidLines:!!d.voidList};
}
function openList(id,kind){
  const L=lineItems(state.month), isB=id==='branch';
  const rows=(kind==='cancel'?L.cancels:L.voids).filter(x=>isB||x.id===id).sort((a,b)=>(b.d||'').localeCompare(a.d||'')||a.l.localeCompare(b.l));
  const name=isB?`${LOCATION} branch`:(rows[0]?.who||[...compute(state.month,'month').board].find(t=>t.id===id)?.display||'');
  const tally={}; rows.forEach(x=>tally[x.reason]=(tally[x.reason]||0)+1);
  const rolled=kind==='void'?(L.rolled[isB?'branch':id]||0):0;
  const fmtD=x=>x?new Date(x+'T12:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
  const missing=kind==='cancel'?!L.hasCancelLines:!L.hasVoidLines;
  const head=['Location #','Location name','Reason',...(isB?['Tech']:[]),'Service','Date',...(kind==='void'?['Amount']:[])];
  const body=rows.map(x=>[esc(x.l),esc(x.n||'—'),esc(x.reason),...(isB?[`<button type="button" class="linkish" data-tech="${esc(x.id)}">${esc(x.who)}</button>`]:[]),esc(x.s||''),fmtD(x.d),...(kind==='void'?[money(x.a)]:[])]);

  $('#techTitle').innerHTML=`${esc(name)} · ${kind==='cancel'?'Cancellations':'Voids'} <span class="statusTag">${esc(monthName(state.month))}</span>`;
  $('#techBody').innerHTML=`
    ${missing?`<p class="banner" style="border-radius:8px">Re-upload the ${kind==='cancel'?'cancel detail':'route completion details'} to see each location.</p>`:''}
    <p class="bigline"><span class="fig">${rows.length}</span> ${kind==='cancel'?'setups cancelled':`order${rows.length===1?'':'s'} voided for other reasons`}${rolled?` plus <b>${rolled}</b> voided because the customer cancelled (shown as one line below; each customer is also in the cancellations list)`:''}.</p>
    ${Object.keys(tally).length?`<div class="tally">${Object.entries(tally).sort((a,b)=>b[1]-a[1]).map(([r,n])=>`<span><b>${n}</b> ${esc(r)}</span>`).join('')}</div>`:''}
    ${rows.length||rolled?rowsTable(head,body).replace('<table>','<table class="list">').replace('</tbody>',rolled?`<tr class="tot"><td colspan="${head.length}">Customer cancelled · <b>${rolled}</b> ${rolled===1?'order':'orders'} voided because the customer cancelled (counted in voids; each customer is listed under cancellations)</td></tr></tbody>`:'</tbody>'):'<p class="sub">Nothing to show for this month.</p>'}
    ${kind==='void'?'<p class="sub">Void % counts every voided order except not-started sales and acquisitions, matching the company report.</p>':''}
    ${!isB?`<div class="actions"><button type="button" class="ghost" data-tech="${esc(id)}">Back to ${esc(name.split(' ')[0])}’s numbers</button></div>`:''}`;
  wireBody($('#techBody'));
  $('#techDlg').showModal();
}
function wireLists(el){
  el.querySelectorAll('[data-list]').forEach(b=>b.addEventListener('click',e=>{ e.stopPropagation(); e.preventDefault(); if($('#techDlg').open) $('#techDlg').close(); openList(b.dataset.who,b.dataset.list); }));
}
/* ---------- Bullseye Bill coaching for each tech ---------- */
const CANCEL_TIP={SERVICE:'Most of your cancels mention service issues. A quick follow-up call after a callback can save the account.',
  'PRICE INCR':'Price increases drove some cancels. Walking customers through what’s included at the next visit shows the value.',
  COMPETITOR:'A few customers left for competitors. Leaving a short note on what you treated keeps your work visible.',
  CLOSEMOVE:'Most of your cancels were moves, which are out of your hands. Ask movers for the new owner’s info so the account can transfer.',
  FINANCIAL:'Money was the main reason customers left. Flag customers who mention cost so the office can offer a lighter plan.',
  COLLECTION:'Collections cancels lead your list. Letting the office know early about past-due accounts gives them time to work it out.',
  'NO NEED':'“No longer needed” led your cancels. Pointing out seasonal pests at each visit keeps the service relevant.',
  EXPIRED:'Expired setups led your cancels. A heads-up to customers before renewal keeps them on the route.',
  'NO CONTACT':'Some customers couldn’t be reached. Confirming phone numbers at the door keeps the line open.'};
const VOID_TIP={REFUSE:'Refusals are your top void. A call or text before you roll cuts most of those.',
  'NO PAY':'Non-payment voids lead your list. A quick look at account status before the stop saves the trip.',
  'NOT HOME':'Not-home voids add up. Confirming gate and access the day before keeps the stop on track.',
  MISSED:'Missed stops showed up. Routing those first thing gets them done.',
  ANIMALS:'Animals blocked a stop. A call-ahead about pets helps.',
  'ADMN ERROR':'An admin error voided a stop. Worth a quick check with the office so it doesn’t repeat.'};
// Bill talks in customers, not dollars: one customer lost needs one customer started to replace it.
// Pass/miss still follows the official goals (cancel % of the book in dollars); the allowance is that goal turned into customers.
const cust=n=>`${n} customer${n===1?'':'s'}`;
const stopsW=n=>`${n} stop${n===1?'':'s'}`;
function cancelAllowance(bookUnits,share){ return bookUnits>0?Math.floor(TARGET.cancel/100*bookUnits*share):null; }
function billTech(t,R){
  if(t.status!=='board') return '';
  const el=R.el, first=t.display.split(' ')[0], wins=[], focus=[];
  const L=lineItems(state.month), myC=L.cancels.filter(x=>x.id===t.id);
  const topC=Object.entries(myC.reduce((a,x)=>(a[x.r]=(a[x.r]||0)+1,a),{})).sort((a,b)=>b[1]-a[1])[0];
  const topV=Object.entries(t.vReasons||{}).sort((a,b)=>b[1]-a[1])[0];
  const rank=sortList(R.board,'health','route').filter(y=>y.health!=null).findIndex(y=>y.id===t.id)+1;
  if(rank===1) wins.push('Top of the board this month. That’s a bullseye!');
  else if(rank>0&&rank<=3) wins.push(`${ordinal(rank)} on the board. Great work.`);
  const compGoal=TARGET.completion*Math.min(el,1);
  if(t.comp!=null&&t.comp>=compGoal) wins.push(el<1?`Stops are on pace: ${pct1(t.comp)} done so far.`:`Stops finished on target at ${pct1(t.comp)}.`);
  const share=Math.min(el,1), c=t.cancels||0, adds=t.adds, bookUnits=(t.bSetups||0)+c-(adds||0);
  // the goal turned into customers / stops for the whole month (exact, not rounded yet)
  const monthC=bookUnits>0?TARGET.cancel/100*bookUnits:null, monthV=t.stops?TARGET.void/100*t.stops:null, early=el<1;
  const allowC=monthC!=null?Math.floor(monthC*share):null;
  const keepTo=(have,cap,unit)=>{ const left=Math.floor(cap)-have; return left>0?`keep it to ${left} more or fewer`:`no more ${unit} this month keeps you inside it`; };
  if(t.cancelPct!=null&&t.cancelPct<=TARGET.cancel*share) wins.push(c===0?'No customers cancelled on your route. That’s a bullseye!'
    :monthC!=null&&c>Math.floor(monthC*share)?`${cust(c)} cancelled, but they were smaller accounts, so you’re still inside the goal.`
    :early&&monthC!=null?`Only ${cust(c)} cancelled so far. The goal allows about ${Math.floor(monthC)} for the whole month, so ${keepTo(c,monthC,'cancels')}.`
    :`Only ${cust(c)} cancelled on your route${monthC!=null?`, inside the goal of about ${Math.floor(monthC)}`:''}.`);
  if(t.voidRate!=null&&t.voidN>0&&t.voidRate<=TARGET.void*share) wins.push(`Only ${stopsW(t.voidN)} voided.`);
  if(t.netGain!=null&&t.netGain>0) wins.push(`You started ${cust(adds)} and lost ${c}, so your route is up ${cust(t.netGain)}.`);
  if(t.voidN===0&&t.completed>0) wins.push('Zero voids. Every stop counted.');
  const final=el>=1;
  if(t.comp!=null&&t.comp<compGoal){ const need=Math.ceil(t.stops*compGoal/100-t.completed);
    focus.push({gap:(compGoal-t.comp)/(100-TARGET.completion),txt:final?`You finished ${need} stop${need===1?'':'s'} short of ${TARGET.completion}%. Getting to the open stops early in the week next month will close that gap.`:`You’re ${need} stop${need===1?'':'s'} from where you should be right now. Knocking out open stops early in the week keeps you ahead.`}); }
  if(t.cancelPct!=null&&t.cancelPct>TARGET.cancel*share){ const g=TARGET.cancel*share, cap=monthC!=null?Math.floor(monthC):null;
    let why;
    if(cap==null) why='';
    else if(early) why=c<cap?`. The goal allows about ${cap} for the whole month and you’re ahead of that pace, so ${keepTo(c,monthC,'cancels')}`:`. The goal allows about ${cap} for the whole month, and you’re already there`;
    else why=c>cap?`. The goal allows about ${cap} for a route your size, so that’s ${c-cap} too many`:`. That’s within the count, but they were bigger accounts, so the goal was missed`;
    focus.push({gap:(t.cancelPct-g)/TARGET.cancel,txt:`${cust(c)} cancelled on your route${why}${adds!=null?`. You started ${adds}`:''}. ${(topC&&CANCEL_TIP[topC[0]])||'Tap your cancel count to see each customer and look for a pattern.'}`}); }
  if(t.voidRate!=null&&t.voidRate>TARGET.void*share){ const g=TARGET.void*share, cap=monthV!=null?Math.floor(monthV):null;
    const why=cap==null?'':cap<1?`. On a route with ${t.stops} stops, even one void goes over the ${TARGET.void}% goal`:early?(t.voidN<cap?`. The goal allows about ${cap} for the whole month, so ${keepTo(t.voidN,monthV,'voids')}`:`. The goal allows about ${cap} for the whole month, and you’re already there`):`. The goal allows about ${cap}, so that’s ${t.voidN-cap} too many`;
    focus.push({gap:(t.voidRate-g)/TARGET.void,txt:`${stopsW(t.voidN)} voided${why}. ${(topV&&VOID_TIP[topV[0]])||'Tap your void count to see each stop and look for a pattern.'}`}); }
  if(t.netGain!=null&&t.netGain<0) focus.push({gap:0.2,txt:`You started ${cust(adds)} and lost ${c}, so you’re ${cust(-t.netGain)} short of breaking even. Every new start replaces one: mention add-on services and ask happy customers for referrals.`});
  const ageTot=t.age.reduce((a,b)=>a+b,0);
  if(ageTot>=3&&t.age[0]/ageTot>=0.34) focus.push({gap:0.1,txt:'Over a third of your cancels were first-year customers. Extra care on the first few visits pays off.'});
  focus.sort((a,b)=>b.gap-a.gap);
  if(!wins.length){ // always lead with something they did well
    const tries=[['voidRate',i=>i===0?'Your void rate is the lowest on the team. Nice work.':`Your void rate is the ${ordinal(i+1)} lowest on the team.`],
      ['cancelPct',i=>i===0?'Your cancel rate is the lowest on the team. Nice work.':`Your cancel rate is the ${ordinal(i+1)} lowest on the team.`],
      ['comp',i=>i===0?'You completed the highest share of stops on the team.':`You completed the ${ordinal(i+1)} highest share of stops on the team.`],
      ['adds',i=>i===0?'You added the most recurring setups on the team. Nice work.':`You added the ${ordinal(i+1)} most recurring setups on the team.`]];
    for(const [f,say] of tries){ const s2=sortList(R.board,f,'route').filter(y=>y[f]!=null); const i=s2.findIndex(y=>y.id===t.id);
      if(i>=0&&i<3&&s2.length>3){ wins.push(say(i)); break; } }
    if(!wins.length&&t.completed) wins.push(`${t.completed.toLocaleString()} stops completed this month. Thanks for the hustle.`);
  }
  const nf=wins.length>=2?1:2;
  const msg=[...wins.slice(0,2),...focus.slice(0,nf).map(f=>f.txt)];
  if(!focus.length) msg.push('Keep doing what you’re doing.');
  if(!msg.length) return '';
  return bill(esc(msg.join(' ')),`Bullseye Bill says, ${first}`);
}
/* ---------- trend-based projections (district board) ----------
   Month end: what's in so far + the rest of the month at the pace this branch's last 3 years say to expect,
   scaled to this year's level. Early in a month that leans on history; by the last week it's almost all actual.
   Year end: actual closed months + this month's projection + every remaining month the same way.
   Branches without history (e.g. a recent acquisition) fall back to their current pace. */
const SERIES={
  sales:d=>d?.salesClass?Object.values(d.salesClass).reduce((a,v)=>a+(v.total||0),0):d?.sales?Object.values(d.sales).reduce((a,v)=>a+(v.recVal||0)+(v.otRev||0)+(v.ex||0),0):null,
  started:d=>d?.sales?Object.values(d.sales).reduce((a,v)=>a+(v.recVal||0),0):null,
  cancels:d=>d?.cancel?Object.values(d.cancel).reduce((a,v)=>a+(v.prod||0),0):null,
  revenue:d=>d?.revenue?d.revenue.total:d?.route&&Object.values(d.route).some(v=>v.doneAmt!=null)?Object.values(d.route).reduce((a,v)=>a+(v.doneAmt||0),0):null,
  startedN:d=>d?.sales?Object.values(d.sales).reduce((a,v)=>a+(v.rec||0),0):null,   // recurring setups started (count)
  cancelN:d=>d?.cancel?Object.values(d.cancel).reduce((a,v)=>a+(v.n||0),0):null,      // setups cancelled (count)
};
const addM=(m,k)=>{ let [y,mo]=m.split('-').map(Number); mo+=k; while(mo>12){mo-=12;y++;} while(mo<1){mo+=12;y--;} return `${y}-${pad(mo)}`; };
function seriesVal(metric,m){ return SERIES[metric](state.months[m]); }
// What the last 3 years say month m should bring, scaled to how this year is running so far
function trendExpected(metric,m){
  const y=+m.slice(0,4), mo=m.slice(5), closed=[];
  for(let k=1;k<+mo;k++) closed.push(`${y}-${pad(k)}`);
  const cur=closed.map(x=>seriesVal(metric,x));
  const vals=[];
  for(let back=1;back<=3;back++){
    const py=y-back, v=seriesVal(metric,`${py}-${mo}`); if(v==null) continue;
    let ratio=1;
    const pairs=closed.map((x,i)=>[cur[i],seriesVal(metric,`${py}-${x.slice(5)}`)]).filter(([a,b])=>a!=null&&b!=null);
    const a=pairs.reduce((s,p)=>s+p[0],0), b=pairs.reduce((s,p)=>s+p[1],0);
    if(pairs.length>=2&&b>0) ratio=Math.min(2,Math.max(0.5,a/b));
    vals.push(v*ratio);
  }
  if(!vals.length) return null;
  return vals.reduce((a,b)=>a+b,0)/vals.length; // average of the preceding years
}
// Month-end projection for a running total
function trendEOM(metric,m,now,share){
  if(now==null) return null;
  if(share>=1) return now;
  const hist=trendExpected(metric,m);
  return hist!=null?now+(1-share)*hist:now/Math.max(share,0.02);
}
// Expected value for a future month: the 3-year trend, or this year's average month when there's no history
function expectOrPace(metric,x,m){
  const e=trendExpected(metric,x); if(e!=null) return e;
  const y=m.slice(0,4), done=[]; for(let j=1;j<+m.slice(5);j++){ const v=seriesVal(metric,`${y}-${pad(j)}`); if(v!=null) done.push(v); }
  return done.length?done.reduce((a,b)=>a+b,0)/done.length:null;
}
// Year-end projection: closed months + this month + the rest of the year
function trendEOY(metric,m,eom){
  const y=m.slice(0,4); let total=0, method='trend';
  for(let k=1;k<=12;k++){ const x=`${y}-${pad(k)}`;
    if(x<m){ total+=seriesVal(metric,x)||0; continue; }
    if(x===m){ total+=eom||0; continue; }
    let e=trendExpected(metric,x);
    if(e==null){ // no history: average of this year's closed months
      const done=[]; for(let j=1;j<+m.slice(5);j++){ const v=seriesVal(metric,`${y}-${pad(j)}`); if(v!=null) done.push(v); }
      e=done.length?done.reduce((a,b)=>a+b,0)/done.length:(eom||0); method='pace'; }
    total+=e; }
  return {total,method};
}
/* ---------- DSW district board: month-end projections for every branch ---------- */
let DISTRICT=false;
function monthsAcrossBranches(){ const set=new Set(); for(const b of CFG.branches) for(const m of Object.keys(state.boards[b.code]?.months||{})) if(m>=START_MONTH) set.add(m); return [...set].sort(); }
// project a running total to month end at the current pace (a closed month is already final)
const toEOM=(v,share)=>v==null?null:share>=1?v:v/Math.max(share,0.02);
function branchKpis(b,month){
  activate(b.code);
  const out={code:b.code,name:b.name,slug:b.slug};
  if(!state.months[month]) return out;
  const R=compute(month,'month'); if(!R) return out;
  const B=R.B, el=R.el||0; out.el=el; out.asOf=R.asOf; out.final=el>=1;
  const D=dorCompare(month,'month'), S=computeSales(month,'month');
  const sNow=seriesVal('sales',month), sShare=D&&!D.missing?D.exp:(S?S.exp:el);
  if(sNow!=null){ const pend=backlogFor(month)?.total||0;
    // backlog is counted in: the month ends at no less than completed + pending, and the trend covers the rest
    const proj=Math.max(trendEOM('sales',month,sNow,sShare),sNow+pend);
    out.sales={now:sNow+pend,done:sNow,proj,budget:D&&!D.missing?D.budget:null,share:sShare,hist:trendExpected('sales',month)!=null,backlog:pend}; }
  if(B.stops&&B.completed!=null){
    // Voided orders stay in total stops but can never be completed, so the most a branch can reach is stops − projected voids
    const projVoids=Math.min(B.stops,toEOM(B.voidN||0,el)), ceiling=B.stops-projVoids;
    out.comp={done:B.done,projDone:Math.max(B.done,Math.min(ceiling,toEOM(B.done,el))),stops:B.stops,projVoids,ceiling}; }
  if(B.cancelPct!=null){
    // cancel $ to month end on the branch's trend, against the book at the start of the month
    const cProj=B.cancelBasis==='dollars'&&B.bookStartVal>0?trendEOM('cancels',month,B.prod,el):null;
    out.cancel={now:B.cancelPct,proj:cProj!=null?cProj/B.bookStartVal*100:toEOM(B.cancelPct,el),basis:B.cancelBasis,n:B.cancels,prod:B.prod,prodProj:cProj,book:B.bookStartVal}; }
  if(B.voidRate!=null) out.voids={n:B.voidN,projN:toEOM(B.voidN,el),stops:B.stops,now:B.voidRate,proj:toEOM(B.voidRate,el)};
  if(B.netGainVal!=null){
    const st=seriesVal('started',month), cc=seriesVal('cancels',month);
    const stP=trendEOM('started',month,st,sShare), ccP=trendEOM('cancels',month,cc,el);
    const stN=trendEOM('startedN',month,seriesVal('startedN',month),sShare), ccN=trendEOM('cancelN',month,seriesVal('cancelN',month),el);
    out.net={now:B.netGainVal,proj:stP!=null&&ccP!=null?stP-ccP:toEOM(B.netGainVal,el),units:B.netGain,unitsProj:stN!=null&&ccN!=null?stN-ccN:toEOM(B.netGain,el),stP,ccP,stN,ccN}; }
  const bv=state.roster.bv?.[month];
  const start=bv?bv.total.annual:(B.bookStartVal||null);
  if(start!=null) out.bv={start,proj:start+(out.net?out.net.proj:0),src:bv?'bv':'book'};
  // Year end against the FY budget plan
  if(out.sales){
    const e=trendEOY('sales',month,out.sales.proj), fy=state.roster.plans?.[month.slice(0,4)]?.budget?.[b.code];
    // later months: never less than the backlog already scheduled for them
    let extra=0; const blm=state.roster.backlog?.months||{};
    for(const [x,v] of Object.entries(blm)) if(x>month&&x.slice(0,4)===month.slice(0,4)){ const exp=expectOrPace('sales',x,month)||0; if(v.total>exp) extra+=v.total-exp; }
    out.eoy={sales:e.total+extra,method:e.method,budget:fy?Object.values(fy).reduce((a,x)=>a+x.total,0):null,backlogLater:backlogLater(month)};
  }
  if(out.net&&out.net.stP!=null&&out.net.ccP!=null){
    const st=trendEOY('started',month,out.net.stP), cc=trendEOY('cancels',month,out.net.ccP);
    out.eoy=out.eoy||{}; out.eoy.net=st.total-cc.total;
    if(out.net.stN!=null&&out.net.ccN!=null) out.eoy.netUnits=trendEOY('startedN',month,out.net.stN).total-trendEOY('cancelN',month,out.net.ccN).total;
    // business valuation at year end: start of this month + this month's net gain + the rest of the year's
    if(out.bv){ let rest=0; const y=month.slice(0,4);
      for(let k=+month.slice(5)+1;k<=12;k++){ const x=`${y}-${pad(k)}`; const s2=expectOrPace('started',x,month), c2=expectOrPace('cancels',x,month); if(s2!=null&&c2!=null) rest+=s2-c2; }
      out.eoy.bv=out.bv.proj+rest; out.eoy.bvStartYear=out.bv.start; }
  }
  out.growth=growthFor(month,out);
  return out;
}
// Year-over-year growth for the FY: projected year end vs. last year
function yearSum(metric,y){ let t=0,any=false; for(let k=1;k<=12;k++){ const v=seriesVal(metric,`${y}-${pad(k)}`); if(v!=null){ t+=v; any=true; } } return any?t:null; }
function bvYearEnd(y){ // Dec 31 of year y ≈ BV at the start of December + December's net gain
  const dec=state.roster.bv?.[`${y}-12`]; if(!dec) return null;
  const st=seriesVal('started',`${y}-12`)||0, cc=seriesVal('cancels',`${y}-12`)||0; return dec.total.annual+st-cc; }
// Revenue growth: projected FY vs last FY when last year is complete; otherwise the same closed months in both years
function revenueGrowth(month){
  const y=+month.slice(0,4), prevMonths=[], both=[];
  for(let k=1;k<=12;k++){ const pm=`${y-1}-${pad(k)}`, v=seriesVal('revenue',pm); if(v!=null) prevMonths.push(k);
    const cm=`${y}-${pad(k)}`; if(v!=null&&cm<month&&seriesVal('revenue',cm)!=null) both.push(k); }
  if(prevMonths.length===12){
    const prev=yearSum('revenue',y-1), cur=seriesVal('revenue',month);
    const eom=cur!=null?trendEOM('revenue',month,cur,monthElapsed(month,state.months[month]?.sources?.route?.asOf)):null;
    const fy=trendEOY('revenue',month,eom).total;
    return prev&&fy?{pct:(fy/prev-1)*100,now:fy,prev,label:'FY'}:null;
  }
  if(both.length){ const cur=both.reduce((a,k)=>a+seriesVal('revenue',`${y}-${pad(k)}`),0), prev=both.reduce((a,k)=>a+seriesVal('revenue',`${y-1}-${pad(k)}`),0);
    const span=`${monthName(`${y}-${pad(both[0])}`,true)}–${monthName(`${y}-${pad(both[both.length-1])}`,true)}`;
    return prev?{pct:(cur/prev-1)*100,now:cur,prev,label:span,note:`${span} vs same months last year`}:null; }
  return null;
}
function growthFor(month,k){
  const y=+month.slice(0,4), g={};
  const last=yearSum('sales',y-1); g.sales=k.eoy?.sales!=null&&last?{pct:(k.eoy.sales/last-1)*100,now:k.eoy.sales,prev:last}:null;
  const prevBV=bvYearEnd(y-1), haveBVnow=!!state.roster.bv?.[month];
  g.bv=haveBVnow&&k.eoy?.bv!=null&&prevBV?{pct:(k.eoy.bv/prevBV-1)*100,now:k.eoy.bv,prev:prevBV}:null;
  g.revenue=revenueGrowth(month);
  return g;
}
function districtTotals(rows,month){
  activate(CFG.district.code);
  const sum=(f)=>rows.reduce((a,r)=>a+(f(r)||0),0), any=f=>rows.some(r=>f(r)!=null);
  const T={code:'DSW',name:CFG.district.name};
  const shares=rows.map(r=>r.el).filter(x=>x!=null); T.el=shares.length?Math.min(...shares):0; T.final=shares.length&&shares.every(x=>x>=1);
  if(any(r=>r.sales)){
    const dDor=state.roster.dor?.[month];
    const budAll=rows.every(r=>!r.sales||r.sales.budget!=null);
    T.sales={now:sum(r=>r.sales?.now),done:sum(r=>r.sales?.done),proj:sum(r=>r.sales?.proj),backlog:sum(r=>r.sales?.backlog),budget:dDor?dDor.total.budget:(budAll?sum(r=>r.sales?.budget):null)};
  }
  if(any(r=>r.comp)) T.comp={done:sum(r=>r.comp?.done),projDone:sum(r=>r.comp?.projDone),stops:sum(r=>r.comp?.stops),projVoids:sum(r=>r.comp?.projVoids),ceiling:sum(r=>r.comp?.ceiling)};
  const dol=rows.filter(r=>r.cancel&&r.cancel.basis==='dollars'&&r.cancel.book>0);
  if(dol.length){ const book=dol.reduce((a,r)=>a+r.cancel.book,0); T.cancel={now:dol.reduce((a,r)=>a+r.cancel.prod,0)/book*100,proj:dol.reduce((a,r)=>a+r.cancel.proj*r.cancel.book,0)/book,n:sum(r=>r.cancel?.n),partial:dol.length<rows.filter(r=>r.cancel).length}; }
  if(any(r=>r.voids)){ const st=sum(r=>r.voids?.stops); T.voids={n:sum(r=>r.voids?.n),projN:sum(r=>r.voids?.projN),stops:st,now:st?sum(r=>r.voids?.n)/st*100:null,proj:st?sum(r=>r.voids?.projN)/st*100:null}; }
  if(any(r=>r.net)) T.net={now:sum(r=>r.net?.now),proj:sum(r=>r.net?.proj),units:sum(r=>r.net?.units),unitsProj:sum(r=>r.net?.unitsProj)};
  if(any(r=>r.eoy)){ T.eoy={backlogLater:sum(r=>r.eoy?.backlogLater),sales:sum(r=>r.eoy?.sales),budget:rows.some(r=>r.eoy?.budget!=null)?sum(r=>r.eoy?.budget):null,net:any(r=>r.eoy?.net)?sum(r=>r.eoy?.net):null,netUnits:any(r=>r.eoy?.netUnits)?sum(r=>r.eoy?.netUnits):null}; }
  const dbv=state.roster.bv?.[month];
  if(dbv||any(r=>r.bv)){ const start=dbv?dbv.total.annual:sum(r=>r.bv?.start); T.bv={start,proj:start+(T.net?T.net.proj:0),src:dbv?'bv':'sum'};
    if(T.eoy&&any(r=>r.eoy?.bv!=null)) T.eoy.bv=T.bv.proj+sum(r=>r.eoy?.bv!=null?r.eoy.bv-r.bv.proj:0); }
  // district growth: sales summed across branches; BV from the district's own BV exports
  // sales: like for like, only branches that also had sales last year (a new acquisition would inflate growth)
  const same=rows.filter(r=>r.growth?.sales), newer=rows.filter(r=>r.eoy?.sales!=null&&!r.growth?.sales).map(r=>r.code);
  const lastSales=same.reduce((a,r)=>a+r.growth.sales.prev,0), nowSales=same.reduce((a,r)=>a+r.growth.sales.now,0);
  const rv=rows.filter(r=>r.growth?.revenue);
  const revNow=rv.reduce((a,r)=>a+r.growth.revenue.now,0), revPrev=rv.reduce((a,r)=>a+r.growth.revenue.prev,0);
  T.growth={sales:lastSales?{pct:(nowSales/lastSales-1)*100,now:nowSales,prev:lastSales,note:newer.length?`same branches; ${newer.join(', ')} not included (no sales last year)`:''}:null,revenue:revPrev?{pct:(revNow/revPrev-1)*100,now:revNow,prev:revPrev,note:[rv[0]?.growth.revenue.note,rv.length<rows.length?`${rows.filter(r=>!r.growth?.revenue).map(r=>r.code).join(', ')} not included`:''].filter(Boolean).join('; ')}:null,newer};
  const prevBV=(()=>{ const dec=state.roster.bv?.[`${+month.slice(0,4)-1}-12`]; if(!dec) return null;
    const ym=`${+month.slice(0,4)-1}-12`; let st=0,cc=0; for(const b of CFG.branches){ const d=state.boards[b.code]?.months?.[ym]; st+=SERIES.started(d)||0; cc+=SERIES.cancels(d)||0; } return dec.total.annual+st-cc; })();
  T.growth.bv=dbv&&T.eoy?.bv!=null&&prevBV?{pct:(T.eoy.bv/prevBV-1)*100,now:T.eoy.bv,prev:prevBV,note:newer.length?`includes ${newer.join(', ')}, added this year`:''}:null;
  return T;
}
function trackBadge(ok,final,words){ if(ok==null) return ''; const [y,n]=words||(final?['MET','MISSED']:['ON TRACK','OFF TRACK']); return `<span class="pb ${ok?'ok':'no'}">${ok?y:n}</span>`; }
function kpiTiles(k){
  const f=k.final, t=[];
  const now=(s)=>`<span class="s">${s}</span>`;
  if(k.sales){ const p=k.sales.budget?k.sales.proj/k.sales.budget*100:null;
    const bl=!f&&k.sales.backlog>0?k.sales.backlog:0, bud=k.sales.budget;
    t.push(['Sales to budget',p!=null?pct1(p):money(k.sales.proj),`${f?'final':'projected'} ${money(k.sales.proj)}${bud?` of ${money(bud)}`:' · no budget loaded'} · now ${money(k.sales.now)}${bl?` <span class="pend">incl. ${money(bl)} pending</span>`:''}`,p!=null?trackBadge(p>=100,f):'',null,null,bud?miniBar((k.sales.done??k.sales.now)/bud*100,bl/bud*100):'']); }
  else t.push(['Sales to budget','—','no sales data yet','']);
  if(k.comp){ const p=k.comp.stops?k.comp.projDone/k.comp.stops*100:null;
    const cap=k.comp.stops?k.comp.ceiling/k.comp.stops*100:null;
    t.push(['Route completion',pctG(p,TARGET.completion),`${f?'final':'projected'} ${Math.round(k.comp.projDone).toLocaleString()} of ${k.comp.stops.toLocaleString()} · now ${k.comp.done.toLocaleString()} done · ${Math.round(k.comp.projVoids)} projected voids cap it at ${pctG(cap,TARGET.completion)} · goal ${TARGET.completion}%`,trackBadge(p>=TARGET.completion,f)]); }
  else t.push(['Route completion','—','no route report yet','']);
  if(k.cancel) t.push(['Cancel %',pctG(k.cancel.proj,TARGET.cancel),`${f?'final':'projected'} · now ${pctG(k.cancel.now,TARGET.cancel)}${k.cancel.basis==='stops'?' (of stops; no customer list)':''}${k.cancel.partial?' · branches with a customer list':''} · goal ≤${TARGET.cancel}%`,trackBadge(k.cancel.proj<=TARGET.cancel,f)]);
  else t.push(['Cancel %','—','no cancel detail yet','']);
  if(k.voids) t.push(['Void %',pctG(k.voids.proj,TARGET.void),`${f?'final':'projected'} ${Math.round(k.voids.projN)} voids · now ${k.voids.n} of ${k.voids.stops.toLocaleString()} orders · goal ≤${TARGET.void}%`,trackBadge(k.voids.proj<=TARGET.void,f)]);
  else t.push(['Void %','—','no route report yet','']);
  if(k.net){ const u=k.net.unitsProj??k.net.units;
    t.push(['Net gain',fmt('netGain',Math.round(u)),`${f?'final':'projected'} customers (started − cancelled) · now ${fmt('netGain',k.net.units)}`,trackBadge(u>=0,f,['GAINING','SHRINKING'])]); }
  else t.push(['Net gain','—','needs sales + cancel detail','']);
  if(k.bv) t.push(['Business valuation',money(k.bv.proj),`${f?'end of month':'projected end of month'} · ${money(k.bv.start)} at the start${k.bv.src==='book'?' (from the customer list)':''} · ${fmt('netGainVal',k.bv.proj-k.bv.start)}`,trackBadge(k.bv.proj>=k.bv.start,f,['GROWING','SHRINKING'])]);
  else t.push(['Business valuation','—','upload BV or a customer list','']);
  return t;
}
function eoyTiles(k,month){
  const e=k.eoy, y=month.slice(0,4), t=[];
  if(!e) return t;
  if(e.sales!=null){ const p=e.budget?e.sales/e.budget*100:null;
    t.push([`Sales · FY${y.slice(2)} year end`,p!=null?pct1(p):money(e.sales),`projected ${money(e.sales)}${e.budget?` of ${money(e.budget)} budget`:' · no FY budget'}${e.method==='pace'?' · at this year’s pace (no history)':''}${e.backlogLater>0?` · <span class="pend">incl. ${money(e.backlogLater)} backlog already scheduled for later months</span>`:''}`,p!=null?trendBadge(p>=100):'']); }
  if(e.netUnits!=null) t.push([`Net gain · FY${y.slice(2)} year end`,fmt('netGain',Math.round(e.netUnits)),'projected customers started − cancelled for the year',`<span class="pb ${e.netUnits>=0?'ok':'no'}">${e.netUnits>=0?'GAINING':'SHRINKING'}</span>`]);
  if(e.bv!=null) t.push([`Business valuation · Dec 31`,money(e.bv),`projected · ${fmt('netGainVal',e.bv-(k.bv?.proj??e.bv))} after this month`,`<span class="pb ${e.bv>=(k.bv?.start??e.bv)?'ok':'no'}">${e.bv>=(k.bv?.start??e.bv)?'GROWING':'SHRINKING'}</span>`]);
  return t;
}
function growthTile(g,month,small){
  const y=+month.slice(0,4);
  const rows=[['Sales',g?.sales,'FY sales: projected year end vs. last year'],['Business valuation',g?.bv,'Dec 31 BV: projected vs. last year'],['Revenue',g?.revenue,'needs revenue history']];
  const scale=Math.max(10,...rows.map(r=>r[1]?Math.abs(r[1].pct):0));
  const bar=([l,v,why])=>{ if(!v) return `<span class="gr"><span class="grl">${l}</span><span class="grt na"></span><span class="grv na">${l==='Revenue'?'needs revenue for the same months in both years':l==='Business valuation'?(state.roster.bv?.[`${y-1}-12`]?'needs this month’s BV for this branch':'needs BV for Dec '+(y-1)+' and this month'):'no data'}</span></span>`;
    const w=Math.min(Math.abs(v.pct)/scale,1)*50, pos=v.pct>=0;
    return `<span class="gr"><span class="grl">${l}</span><span class="grt"><span class="grc"></span><span class="grf ${pos?'up':'down'}" style="${pos?'left:50%':`left:${50-w}%`};width:${w}%"></span></span><span class="grv ${pos?'up':'down'}"><b>${v.pct>=0?'+':''}${v.pct.toFixed(1)}%</b>${small?(v.label&&v.label!=='FY'?` <span class="grn">${esc(v.label)}</span>`:''):` · ${money(v.now)} vs ${money(v.prev)}${v.note?` <span class="grn">(${esc(v.note)})</span>`:''}`}</span></span>`; };
  return `<div class="${small?'mt':'kpi'} growth"><span class="l">Growth · FY${String(y).slice(2)} vs FY${String(y-1).slice(2)}</span>${rows.map(bar).join('')}</div>`;
}
const trendBadge=ok=>`<span class="pb ${ok?'ok':'no'}">${ok?'ON TRACK':'OFF TRACK'}</span>`;
function renderDistrict(c){
  const ms=monthsAcrossBranches(), sel=$('#monthSel');
  if(!ms.includes(state.dMonth)) state.dMonth=ms[ms.length-1]||null;
  sel.innerHTML=ms.length?ms.slice().reverse().map(m=>`<option value="${m}" ${m===state.dMonth?'selected':''}>${esc(monthName(m))}</option>`).join(''):'<option>No reports yet</option>';
  sel.disabled=!ms.length; sel.onchange=e=>{ state.dMonth=e.target.value; render(); };
  document.querySelectorAll('.admin').forEach(el=>el.style.display='none');
  $('#banner').innerHTML='';
  if(!state.dMonth){ c.innerHTML='<div class="empty"><h2>No numbers posted yet</h2><p>Branch numbers appear here after the next update.</p></div>'; return; }
  const m=state.dMonth, rows=CFG.branches.map(b=>branchKpis(b,m)), T=districtTotals(rows,m);
  activate(CFG.district.code);
  const workdays=planWorkdays(m)||(()=>{ const [y,mo]=m.split('-').map(Number), hol=holidaySet(); let n=0; for(let d=1;d<=new Date(y,mo,0).getDate();d++) if(isWorkday(new Date(y,mo-1,d,12),hol)) n++; return n; })();
  const asOf=rows.map(r=>r.asOf).filter(Boolean).sort().pop();
  // Bill's one-line read across the district
  const keys=[['sales',r=>r.sales&&r.sales.budget?r.sales.proj>=r.sales.budget:null,'sales budget'],['comp',r=>r.comp?r.comp.projDone/r.comp.stops*100>=TARGET.completion:null,'route completion'],['cancel',r=>r.cancel?r.cancel.proj<=TARGET.cancel:null,'cancels'],['voids',r=>r.voids?r.voids.proj<=TARGET.void:null,'voids']];
  const lines=keys.map(([k,f,lbl])=>{ const v=rows.map(r=>({n:r.code,ok:f(r)})).filter(x=>x.ok!=null); if(!v.length) return null; const off=v.filter(x=>!x.ok).map(x=>x.n); return off.length?`${lbl}: ${off.join(', ')} off track`:`${lbl}: every branch on track`; }).filter(Boolean);
  c.innerHTML=`
    <h3 class="dh">Month end</h3>
    ${kpiStrip(kpiTiles(T),'district')}
    ${T.eoy?`<h3 class="dh">Year end</h3>${kpiStrip(eoyTiles(T,m),'district').replace(/<\/div>$/,growthTile(T.growth,m)+'</div>')}`:''}
    <p class="periodline">${esc(CFG.district.name)} · ${esc(monthName(m))} · ${T.final?'final month-end numbers':`projections blend the current pace with each branch’s last 3 years${asOf?`, data through ${esc(new Date(asOf+'T12:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}))}`:''} · ${Math.round(T.el*workdays)} of ${workdays} workdays`}</p>
    ${lines.length?bill(esc(lines.join('; ')+'.'),'Bullseye Bill’s district read'):''}
    <div class="dgrid">${rows.map(r=>`<section class="dcard">
      <header><h2>${esc(r.name)} <span class="sub">${esc(r.code)}</span></h2><a class="more" href="../${esc(r.slug)}/">Open board ›</a></header>
      ${r.el==null?'<p class="sub">No numbers for this month yet.</p>':`<div class="mtiles">${[...kpiTiles(r),...eoyTiles(r,m)].map(([l,v,sub,badge,_l,_c,bar])=>`<div class="mt ${badge&&badge.includes('pb no')?'off':badge?'onp':''}"><span class="l">${esc(l)}</span><span class="v">${v}</span>${bar||''}${badge||''}<span class="s">${sub}</span></div>`).join('')}${r.eoy?growthTile(r.growth,m,true):''}</div>`}
    </section>`).join('')}</div>
    <details class="foot"><summary>How projections work</summary><div class="srcs sub">
      <span>Month end: what’s in so far, plus the rest of the month at the pace each branch’s last 3 years say to expect for that month (scaled to how this year is running). Early in the month that leans on history; by the last week it’s almost all actual. Workdays follow the company’s working-day counts from the FY budget plan. Route completion and voids use the current pace; voided orders stay in total stops, so projected completion can never pass 100% minus the projected void rate. Closed months show final numbers.</span>
      <span>Backlog: sales already written but not completed, counted in the totals and drawn dashed, because a customer can still back out or the work can slip into next month. This month’s work dates count toward the month (the month can’t project below completed + pending); later work dates set a floor for those months in the year-end projection.</span>
      <span>Year end: actual closed months, plus this month’s projection, plus each remaining month on the same 3-year trend; compared with the FY budget plan. Branches without history use this year’s pace.</span>
      <span>Sales: captured sales from Sales Details vs. the DOR sales budget. Route completion: completed vs. every order on the route completion report. Cancel %: annual $ cancelled ÷ the active book (company Net Gain method). Void %: voided orders ÷ total orders. Net gain: recurring $ started − $ cancelled.</span>
      <span>Business valuation: the BV export’s beginning annual BV (or the customer list’s active annual $ when no BV is loaded), plus projected net gain.</span></div></details>`;
}
/* ---------- tech detail ---------- */
function openTech(id){
  const R=compute(state.month,state.mode), Y=compute(state.month,'ytd');
  const all=[...R.board,...R.termed,...R.staff,...R.other,...R.main], t=all.find(x=>x.id===id); if(!t) return;
  const yt=[...Y.board,...Y.termed,...Y.staff,...Y.other,...Y.main].find(x=>x.id===id);
  const ranked=t.status==='board';
  const rank=(f,sec)=>{ if(!ranked) return ''; const s=sortList(R.board,f,sec).filter(y=>y[f]!=null); const i=s.findIndex(y=>y.id===id); return i<0?'':`${ordinal(i+1)} of ${s.length}`; };
  const ta=f=>avg(R.board.map(y=>y[f]));
  const table=(title,rows)=>rows.length?`<h3>${title}</h3><div class="tbl"><table class="stats"><thead><tr><th>Measure</th><th>${esc(t.display.split(' ')[0])}</th><th>Team avg</th><th>Rank</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</tbody></table></div>`:'';
  const route=[],sales=[];
  if(t.cancels!=null) route.push(['Cancellations',t.cancels,fmt('c',ta('cancels')),'']);
  if(t.stops!=null) route.push(['Stops scheduled',t.stops.toLocaleString(),fmt('stops',ta('stops')),'']);
  if(t.completed!=null) route.push(['Stops completed',t.completed.toLocaleString(),fmt('completed',ta('completed')),'']);
  if(t.comp!=null) route.push([`Completion % (goal ${TARGET.completion}%)`,`${pct(t.comp)} ${paceBadge('completion',t.comp,R.el)}`,pct(ta('comp')),rank('comp','route')]);
  if(t.cancelPct!=null) route.push([`Cancel % (goal ≤${TARGET.cancel}%)`,`${pctG(t.cancelPct,TARGET.cancel)} ${paceBadge('cancel',t.cancelPct,R.el)}<br><span class="sub">${t.cancelBasis==='dollars'?`${money(t.prod)} of ${money(t.bookStartVal)} on their book`:`${t.cancels} of ${t.stops} stops`}</span>`,pct1(ta('cancelPct')),rank('cancelPct','route')]);
  if(t.cancelRate!=null) route.push(['Cancels per 100 services',t.cancelRate.toFixed(1),ta('cancelRate')?.toFixed(1)??'—',rank('cancelRate','route')]);
  if(t.cancelShare!=null) route.push(['Share of branch cancels',pct(t.cancelShare),pct(ta('cancelShare')),rank('cancelShare','route')]);
  if(t.voidRate!=null) route.push(['Voids',`${t.voidN} ${paceBadge('void',t.voidRate,R.el)}<br><span class="sub">${pctG(t.voidRate,TARGET.void)} of ${t.stops} orders · ${money(t.voidVal)} not billed · goal ≤${TARGET.void}%</span>`,fmt('voidN',ta('voidN')),rank('voidN','route')]);
  if(t.adds!=null) route.push(['Recurring adds',t.adds,fmt('adds',ta('adds')),rank('adds','route')]);
  if(t.otUnits!=null) route.push(['One-time jobs sold',t.otUnits,fmt('otUnits',ta('otUnits')),'']);
  if(t.netGainVal!=null) route.push(['Net gain $',`${fmt('netGainVal',t.netGainVal)}<br><span class="sub">${money(t.addVal||0)} started − ${money(t.prod)} cancelled</span>`,fmt('netGainVal',ta('netGainVal')),rank('netGainVal','route')]);
  if(t.netGain!=null) route.push(['Net setup gain',fmt('netGain',t.netGain),fmt('netGain',ta('netGain')),rank('netGain','route')]);

  let monthly='';
  if(yt&&Y.has.cancel){ const ms=Y.ms.filter(m=>m>=START_MONTH&&state.months[m]?.cancel); const mx=Math.max(...ms.map(m=>yt.cByM[m]||0),1);
    monthly=`<h3>Cancellations by month</h3><div class="minibars">${ms.map(m=>`<div style="height:${(yt.cByM[m]||0)/mx*100}%" title="${yt.cByM[m]||0}"></div>`).join('')}</div>
      <div class="minilab">${ms.map(m=>`<span>${esc(monthName(m,true))}<br><b>${yt.cByM[m]||0}</b></span>`).join('')}</div>`; }
  const statusLbl={termed:'Termed',staff:'Not on the board',other:'Branch only',main:'Main branch'}[t.status];
  $('#techTitle').innerHTML=esc(t.display)+(statusLbl?`<span class="statusTag">${statusLbl}</span>`:'');
  const canToggle=!['other','termed','main'].includes(t.status)&&state.canEdit!==false;
  $('#techBody').innerHTML=`
    ${ranked?`<div class="big ${band(t.p.health)}"><span class="num">${t.health??'—'}</span><span class="lab">points of ${SCORE_MAX}${t.health!=null?`, ${rank('health','route')}`:''}</span></div>
      ${t.scoreParts&&Object.keys(t.scoreParts).length?`<div class="scorebar">${(()=>{ const avail=Object.values(t.scoreParts).reduce((a,x)=>a+x.w,0), k=avail?SCORE_MAX/avail:1;
        return SCORE_GROUPS.map(([lbl,keys])=>{ const w=keys.reduce((a,x)=>a+SCORE_WEIGHTS[x],0), has=keys.some(x=>t.scoreParts[x]), pts=keys.reduce((a,x)=>a+(t.scoreParts[x]?t.scoreParts[x].pts*k:0),0);
          return `<span class="sp"><span class="spl">${lbl}</span><span class="spt"><span class="spf" style="width:${has?Math.min(pts/w*100,100):0}%"></span></span><span class="spv">${has?Math.round(pts):'—'} / ${w}</span></span>`; }).join(''); })()}</div>`:''}`
      :`<p class="sub">${t.status==='termed'?`Not on the active ${LOCATION} employment list, so this person’s numbers count in the branch total only.`:t.status==='staff'?'Active, but not in a field technician department, so counted in the branch total only.':t.status==='main'?'Assigned to the main branch, so these numbers count in the branch total only.':'Counted in the branch total only.'}</p>`}
    <p class="sub">${esc(periodLabel())}</p>
    ${state.mode==='month'?billTech(t,R):''}
    ${state.mode==='month'&&(t.cancels||t.voidN)?`<div class="actions"><button type="button" class="ghost" data-list="cancel" data-who="${esc(id)}">See ${t.cancels||0} cancellation${t.cancels===1?'':'s'}</button><button type="button" class="ghost" data-list="void" data-who="${esc(id)}">See ${t.voidN||0} void${t.voidN===1?'':'s'}</button></div>`:''}
    ${table('Route',route)}
    ${(()=>{ const vr=Object.entries(t.vReasons||{}).sort((a,b)=>b[1]-a[1]); const bits=[];
      if(vr.length) bits.push(`Void reasons: ${vr.map(([r,n])=>`${esc(VOID_LBL[r]||tc(r))} ${n}`).join(', ')}.`);
      if(t.cvN) bits.push(`${t.cvN} services voided because the customer cancelled${t.cvExtra?`; ${t.cvExtra} of those aren’t in the cancel detail yet and are included in their cancels`:''}.`);
      return bits.length?`<p class="sub">${bits.join(' ')}</p>`:''; })()}${table('Sales',sales)}${monthly}
    ${t.c?`<h3>How long their cancelled customers had been with us</h3>${ageBlock(t,t.display.split(' ')[0])}`:''}
    ${canToggle?`<div class="actions admin"><button type="button" class="ghost" id="toggleShow">${ranked?'Take off the board (branch total only)':'Put on the board'}</button></div>`:''}`;
  $('#toggleShow')?.addEventListener('click',()=>setShow(id,ranked?'branch':'board'));
  wireLists($('#techBody'));
  $('#techDlg').showModal();
}
async function setShow(id,v){
  markDirty();
  const r=JSON.parse(JSON.stringify(state.roster)); r.show=r.show||{}; r.show[id]=v; state.roster=r;
  try{ if(state.db) await state.db.doc('roster/main').set(r); }catch(e){ alert('Couldn’t save that change.'); }
  $('#techDlg').close(); render();
}

/* ---------- report parsing ---------- */
function detect(rows){
  for(let i=0;i<Math.min(rows.length,40);i++){
    const h=rows[i].map(c=>String(c??'').trim()), has=x=>h.includes(x);
    if(has('Cancel Date')&&has('Tech Name')) return {type:'cancel',hi:i,h};
    if(has('Employee Status Description')&&has('Location Description')) return {type:'employees',hi:i,h};
    if(has('Sales Type')&&has('Technician Name')) return {type:'sales',hi:i,h};
    if(h.some(c=>/^FY'?\d\d Budget/i.test(c))&&rows.slice(i,i+6).some(r=>r.some(c=>String(c).trim()==='Working Days'))) return {type:'plan',hi:i,h};
    if(has('ClassCode')&&has('Sales Budget')) return {type:'dor',hi:i,h};
    if(has('Service Class')&&has('Beginning Annual BV')) return {type:'bv',hi:i,h};
    if(has('Started Recurring Sales')&&has('Net Gain')) return {type:'netgain',hi:i,h};
    if(has('Bucket')&&has('Work Date')&&has('Total Sales')) return {type:'backlog',hi:i,h};
    if(has('Period')&&has('SubTotal')&&has('Branch')&&!has('Status')) return {type:'revenue',hi:i,h};
    if(has('Status')&&has('Technician Name')&&has('Work Date')) return {type:'route',hi:i,h};
    if(has('Tech 1')&&has('Work Date')) return {type:'open',hi:i,h};
  }
  return null;
}
function objects(rows,hi,h){ return rows.slice(hi+1).map(r=>{ const o={}; h.forEach((k,j)=>{ if(k) o[k]=r[j]; }); return o; }); }
const inBranch=o=>!('Branch' in o)||String(o.Branch).trim().toUpperCase()===BRANCH;
function parseReport(file,wb){
  for(const sn of wb.SheetNames){
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:'',raw:true,blankrows:false});
    const d=detect(rows); if(!d) continue;
    const objs=objects(rows,d.hi,d.h).filter(inBranch);
    const out={type:d.type,file:file.name,months:{},codes:{},termedSeen:{}};
    const seen=n=>{ if(n?.termed) out.termedSeen[n.key]=n.termed; };
    if(d.type==='revenue'){
      // Revenue (invoiced SubTotal) by month. Row-level detail or a Branch × Period summary both work.
      const truncated=rows.some(r=>r.some(c=>/exceeded the allowed volume/i.test(String(c))));
      const months={}; const cnt={};
      for(const o of objs){ const per=String(o['Period']??'').replace(/\.0$/,'').trim(); const mm=per.match(/^(\d{4})(\d{2})$/); if(!mm) continue;
        const m=`${mm[1]}-${mm[2]}`, v=num(o['SubTotal'])||0; (months[m]||(months[m]={total:0,n:0})); months[m].total+=v; months[m].n++; }
      let keep=Object.keys(months).sort(), dropped=[];
      if(truncated&&keep.length){
        // Power BI cut the export off: months at the end have only a sliver of rows, and the month before them may be partial too
        const med=[...keep.map(m=>months[m].n)].sort((a,b)=>a-b)[Math.floor(keep.length/2)];
        let last=keep.length-1; while(last>=0&&months[keep[last]].n<med*0.2) last--;
        dropped=keep.slice(last); keep=keep.slice(0,last);
      }
      out.months={}; for(const m of keep) out.months[m]=months[m];
      out.summary=keep.length?`Revenue ${money(keep.reduce((a,m)=>a+months[m].total,0))} for ${monthName(keep[0],true)} ${keep[0].slice(0,4)} – ${monthName(keep[keep.length-1],true)} ${keep[keep.length-1].slice(0,4)}.${truncated?` Power BI cut this export off at its row limit, so ${dropped.map(m=>monthName(m,true)+' '+m.slice(0,4)).join(', ')} were left out. Export the rest in smaller date ranges, or as a Branch × Period summary.`:''}`:'No complete months in this export.';
      return out;
    }
    if(d.type==='backlog'){
      // Backlog: sales written but not completed yet, by work date. A snapshot: each upload replaces the last one.
      const months={}; let n=0, latest='';
      for(const o of objs){ const wd=toDate(o['Work Date']); if(!wd) continue;
        const total=num(o['Total Sales'])||0; if(total<=0) continue;
        const isRec=/recur/i.test(o['Sales Type']||''), rec=isRec?(num(o['Annual Value'])||0):0;
        const m=ym(wd), M=months[m]||(months[m]={total:0,rec:0,ot:0,n:0,bySp:{}});
        const sp=parseName(o['Salesperson'])||{key:'unassigned|'}, x=M.bySp[sp.key]||(M.bySp[sp.key]={total:0,rec:0,ot:0,n:0});
        for(const t of [M,x]){ t.total+=total; t.rec+=rec; t.ot+=total-rec; t.n++; }
        n++; const ad=toDate(o['Add Date']); if(ad){ const a=ymd(ad); if(a>latest) latest=a; } }
      const cur=curYM(), now=months[cur], later=Object.entries(months).filter(([m])=>m>cur).reduce((a,[,v])=>a+v.total,0);
      out.backlog={months,asOf:latest||todayStr()};
      out.summary=`${n} pending sales: ${now?`${money(now.total)} scheduled in ${monthName(cur)} (${now.n} orders)`:`nothing for ${monthName(cur)}`}${later?`, ${money(later)} in later months`:''}. Replaces the previous backlog.`;
      return out;
    }
    if(d.type==='netgain'){ const e=new Error('This is the Net Gain summary. The board doesn’t need it: it builds net gain from Sales Details and Cancel Detail, month by month and branch by branch. For history, upload a 3-year Cancel Detail export instead.'); e.userFacing=true; throw e; }
    if(d.type==='plan'){
      // FY budget plan: monthly working days and sales budget (total, recurring, one-time) for every branch. Read once a year.
      const yy=String(rows[d.hi].find(c=>/^FY'?\d\d Budget/i.test(c))||'').match(/(\d\d)/), year=2000+(+yy[1]);
      const MN=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const hdr=rows.findIndex(r=>String(r[1]).trim()==='MUC'&&r.some(c=>/^jan/i.test(String(c).trim())));
      const cols=[]; rows[hdr].forEach((c,j)=>{ const k=MN.indexOf(String(c).trim().slice(0,3).toLowerCase()); if(k>=0&&j<20&&!cols[k]) cols[k]=j; });
      const wd=rows.find(r=>r.some(c=>String(c).trim()==='Working Days'));
      const workdays={}; cols.forEach((j,k)=>{ const v=num(wd[j]); if(v) workdays[`${year}-${pad(k+1)}`]=v; });
      const budget={}; const kind={Total:'total',Recurring:'rec','One-Time':'ot'};
      for(const r of rows){ const t=kind[String(r[4]||'').trim()], code=String(r[3]||'').trim().toUpperCase();
        if(!t||String(r[5]||'').trim()!=='Forecast'||!/^[A-Z]{2,4}$/.test(code)||code==='TOTAL') continue;
        cols.forEach((j,k)=>{ const m=`${year}-${pad(k+1)}`, b=((budget[code]||(budget[code]={}))[m]||(budget[code][m]={total:0,rec:0,ot:0})); b[t]=num(r[j])||0; }); }
      out.plan={year,workdays,budget};
      const fy=c=>Object.values(budget[c]||{}).reduce((a,x)=>a+x.total,0);
      out.summary=`FY${year} budget plan: working days for ${Object.keys(workdays).length} months; sales budget for ${Object.keys(budget).join(', ')}${budget[BRANCH]?` (${BRANCH} ${money(fy(BRANCH))} for the year)`:''}.`;
      return out;
    }
    if(d.type==='bv'){
      // Business valuation (BV) at the start of the month, by service class. One branch → that branch; several → the district.
      const note=rows.map(r=>r.join(' ')).find(x=>/Applied filters/i.test(x))||'', nb=noteBranches(note);
      const bcol=d.h.includes('BranchName')?'BranchName':d.h.includes('Branch')?'Branch':null;
      let src;
      if(bcol){ const all=objects(rows,d.hi,d.h); src=BRANCH===DISTRICT_CODE?all:all.filter(o=>String(o[bcol]||'').trim().toUpperCase()===BRANCH); if(!src.length) return null; }
      else { if(nb.length>1){ if(BRANCH!==DISTRICT_CODE) return null; } else if(nb.length===1){ if(nb[0]!==BRANCH) return null; } else if(BRANCH!==(state.cur||BRANCH)) return null; src=objs; }
      const byClass={}; let total=null;
      for(const o of src){ const c=String(o['Service Class']||'').trim(); if(!c||/applied filters/i.test(c)) continue;
        const row={annual:num(o['Beginning Annual BV'])||0,monthly:num(o['Beginning Month BV'])||0};
        if(/^total$/i.test(c)) { if(!bcol) total=row; } else if(row.annual||row.monthly){ const x=byClass[c.toUpperCase()]||(byClass[c.toUpperCase()]={annual:0,monthly:0}); x.annual+=row.annual; x.monthly+=row.monthly; } }
      if(!total){ total={annual:0,monthly:0}; for(const r of Object.values(byClass)){ total.annual+=r.annual; total.monthly+=r.monthly; } }
      const months=noteMonths(note);
      if(!total.annual){ const e=new Error(months.length>1?'This BV export is blank. BV is a start-of-month snapshot, so Power BI shows nothing when several months are selected. Export one month (the current month) instead; the board works out earlier months from the sales and cancel history.':'This BV export has no values.'); e.userFacing=true; throw e; }
      out.bv={months,total,byClass,branches:nb};
      out.summary=`Business valuation at the start of ${months.map(m=>monthName(m)).join(', ')}: ${money(total.annual)} annual (${money(total.monthly)} monthly)${nb.length?` for ${nb.join(', ')}`:''}.`;
      return out;
    }
    if(d.type==='dor'){
      // Power BI DOR sales budget. The "Applied filters" note says which months it covers.
      const note=rows.map(r=>r.join(' ')).find(x=>/Applied filters/i.test(x))||'';
      const nb=noteBranches(note);
      if(nb.length>1){ if(BRANCH!==DISTRICT_CODE) return null; }            // all-branch budget → district board
      else if(nb.length===1){ if(nb[0]!==BRANCH) return null; }
      else if(BRANCH!==(state.cur||BRANCH)) return null;
      const MN=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      let months=[...note.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? (\d{4})\b/gi)].map(x=>x[2]+'-'+pad(MN.indexOf(x[1].slice(0,3).toLowerCase())+1));
      if(/current month/i.test(note)){ const last=months.sort().slice(-1)[0]; let cm=todayStr().slice(0,7);
        if(last){ const [y,mo]=last.split('-').map(Number); cm=mo===12?(y+1)+'-01':y+'-'+pad(mo+1); } months.push(cm); }
      months=[...new Set(months)].sort();
      if(!months.length) months=[todayStr().slice(0,7)];
      const byClass={}; let total=null;
      for(const o of objs){ const c=String(o['ClassCode']||'').trim(); if(!c||/applied filters/i.test(c)) continue;
        const row={sales:num(o['MTD Total Sales'])||0,budget:num(o['Sales Budget'])||0,rec:num(o['MTD Recurring Sales'])||0,recBudget:num(o['Budget Recurring Sales'])||0,
          ot:(num(o['MTD One Time Sales'])||0)+(num(o['MTD Excess Initial Sales'])||0),otBudget:num(o['Budget One Time & Ex Initial Sales'])||0,count:num(o['MTD Total Sales Count'])||0};
        if(/^total$/i.test(c)) total=row; else byClass[c.toUpperCase()]=row; }
      if(!total){ total={sales:0,budget:0,rec:0,recBudget:0,ot:0,otBudget:0,count:0}; for(const r of Object.values(byClass)) for(const k in total) total[k]+=r[k]; }
      out.dor={months,total,byClass};
      out.summary=`Sales budget for ${months.length===1?monthName(months[0]):`${monthName(months[0],true)}–${monthName(months[months.length-1],true)} ${months[0].slice(0,4)}`}: ${money(total.budget)} total (${money(total.recBudget)} recurring, ${money(total.otBudget)} one-time & initial) across ${Object.keys(byClass).length} service classes.`;
      return out;
    }
    if(d.type==='employees'){
      out.employees=objs.filter(o=>String(o['Location Description']).trim().toLowerCase()===LOCATION.toLowerCase()&&!/term/i.test(o['Employee Status Description']||'')&&o['Last Name'])
        .map(o=>({id:String(o['Employee Id']||o['Last Name']+o['Preferred/First Name']),first:String(o['Preferred/First Name']||'').trim(),last:String(o['Last Name']).trim(),dept:String(o['Department Description']||''),title:String(o['Position Description']||''),status:String(o['Employee Status Description']||'')}));
      const field=out.employees.filter(e=>FIELD_DEPT.test(e.dept)).length;
      out.summary=`${out.employees.length} active ${LOCATION} employees, ${field} in field departments (ranked on the board).`;
      return out;
    }
    if(d.type==='cancel'){
      let n=0, dupS=0, dupL=0; const seenSetup=new Set(), seenLine={}; out.spCancel={}; out.cancelLocs={}; out.cancelList={}; out.cancelClass={};
      for(const o of objs){ const dt=toDate(o['Cancel Date']); if(!dt) continue;
        const sid=idStr(o['Setup ID']); if(sid){ if(seenSetup.has(sid)){ dupS++; continue; } seenSetup.add(sid); }
        const nm=parseName(o['Tech Name'])||{key:'unassigned|'}; seen(nm); if(o['Tech Code']&&nm.key) out.codes[String(o['Tech Code']).trim()]=nm.key;
        let yrs=num(o['Years']); if(yrs==null){ const st=toDate(o['Start Date']); if(st) yrs=(dt-st)/(365.25*864e5); }
        const prod=num(o['Production Amount'])||0, ai=ageIdx(yrs);
        const lk=idStr(o['Location Code'])+'|'+String(o['Service Code']??'').trim().toUpperCase()+'|'+ymd(dt);
        if(seenLine[lk]){ const t0=seenLine[lk]; t0.prod+=prod; if(ai!=null) t0.ageProd[ai]+=prod; dupL++; continue; }
        const m=ym(dt), M=out.months[m]||(out.months[m]={}), t=M[nm.key]||(M[nm.key]={n:0,prod:0,age:[0,0,0,0,0,0],ageProd:[0,0,0,0,0,0],reasons:{}});
        seenLine[lk]=t;
        { const cc=String(o['Service Class']||'OTHER').trim().toUpperCase()||'OTHER', CC=out.cancelClass[m]||(out.cancelClass[m]={}), cx=CC[cc]||(CC[cc]={n:0,prod:0}); cx.n++; cx.prod+=prod; }
        if(m>=LIST_FROM){ const lname=String(o['Location Company']||'').trim()||[o['Location Last Name'],o['Location First Name']].map(x=>String(x||'').trim()).filter(Boolean).join(', ');
          (out.cancelList[m]||(out.cancelList[m]=[])).push({l:idStr(o['Location Code']),n:lname,r:String(o['Cancel Reason']||'OTHER').trim().toUpperCase(),s:String(o['Service Code']??'').trim().toUpperCase(),d:ymd(dt),k:nm.key,p:Math.round(prod)}); }
        if(m>=LIST_FROM) (out.cancelLocs[m]||(out.cancelLocs[m]=[])).push(idStr(o['Location Code'])+'|'+String(o['Service Code']??'').trim().toUpperCase());
        const sp=parseName(o['Salesperson Name']); if(sp){ const S=out.spCancel[m]||(out.spCancel[m]={}), x=S[sp.key]||(S[sp.key]={n:0,early:0}); x.n++; if(yrs!=null&&yrs<1) x.early++; }
        t.n++; t.prod+=prod; if(ai!=null){ t.age[ai]++; t.ageProd[ai]+=prod; }
        const r=String(o['Cancel Reason']||'OTHER').trim().toUpperCase()||'OTHER'; t.reasons[r]=(t.reasons[r]||0)+1; n++; }
      out.summary=`${n} cancellations across ${Object.keys(out.months).length} months${dupS||dupL?`, after removing ${dupS} repeated setups and combining ${dupL} same-day cancels of the same service at the same location`:''}.`;
    }
    if(d.type==='sales'){
      let rec=0,ot=0,dup=0; out.asOf={}; out.by='salesperson'; out.growth={}; out.salesClass={}; const seenO=new Set();
      for(const o of objs){
        const on=String(o['Invoice Num']??o['Order Num']??'').trim(); if(on){ if(seenO.has(on)){ dup++; continue; } seenO.add(on); }
        let m=null; const my=String(o['Month Year']||'').match(/^([A-Za-z]{3})-(\d{4})$/);
        if(my){ const i=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(my[1].toLowerCase()); if(i>=0) m=my[2]+'-'+pad(i+1); }
        if(!m){ const dt=toDate(o['Invoice Date']); if(dt) m=ym(dt); } if(!m) continue;
        const M=out.months[m]||(out.months[m]={});
        const nm=parseName(o['Salesperson Name'])||{key:'unassigned|'}; seen(nm);
        const t=M[nm.key]||(M[nm.key]={rec:0,recVal:0,recTotal:0,ot:0,otRev:0,ex:0}), total=num(o['Total Sales'])||0;
        const isRec=/recur/i.test(o['Sales Type']);
        // Excess initial: the extra charged on a recurring setup's first service. The DOR counts it with one-time sales.
        const exI=isRec?(num(o['Excess Intial']??o['Excess Initial'])||0):0, annual=isRec?(num(o['Annual Value'])||0):0;
        if(isRec){ t.rec++; t.recVal+=annual; t.recTotal+=total; t.ex+=exI; rec++; } else { t.ot++; t.otRev+=total; ot++; }
        const cls=String(o['Service Class']||'OTHER').trim().toUpperCase()||'OTHER';
        const SC=out.salesClass[m]||(out.salesClass[m]={}), sc=SC[cls]||(SC[cls]={total:0,rec:0,ot:0,ex:0,n:0});
        sc.total+=total; sc.n++; if(isRec){ sc.rec+=annual; sc.ex+=exI; } else sc.ot+=total;
        const tn=parseName(o['Technician Name'])||{key:'unassigned|'}; seen(tn); if(o['Technician Code']) out.codes[String(o['Technician Code']).trim()]=tn.key;
        const G=out.growth[m]||(out.growth[m]={}), gt=G[tn.key]||(G[tn.key]={rec:0,ot:0,recVal:0}); if(isRec){ gt.rec++; gt.recVal+=annual; } else gt.ot++;
        const dt=toDate(o['Invoice Date']); if(dt){ const ds=ymd(dt); if(ds.slice(0,7)===m&&(!out.asOf[m]||ds>out.asOf[m])) out.asOf[m]=ds; }
      }
      out.summary=`${rec} recurring sales and ${ot} one-time sales across ${Object.keys(out.months).length} months${dup?`, ${dup} repeated invoices removed`:''}.`;
    }
    if(d.type==='route'){
      let done=0,vd=0,cvN=0,nsN=0; out.asOf={}; out.ns={}; out.cvLocs={}; out.voidList={};
      const seenO=new Set(); let dup=0;
      for(const o of objs){ const dt=toDate(o['Work Date']); if(!dt) continue;
        const on=String(o['Order Num']??'').trim(); if(on){ if(seenO.has(on)){ dup++; continue; } seenO.add(on); }
        const nm=parseName(o['Technician Name'])||{key:'unassigned|'}; seen(nm); if(o['Technician Code']) out.codes[String(o['Technician Code']).trim()]=nm.key;
        const xp=String(o['xPeriod']||'').match(/^(\d{4})(\d{2})$/);
        const m=xp?xp[1]+'-'+xp[2]:ym(dt);
        const reason=String(o['NS-Void Reason Code']??'').trim().toUpperCase(), sub=num(o['SubTotal'])||0;
        // Not started = a sale that backed out before the first service. Removed so it doesn't distort route numbers.
        if(reason==='NOTSTARTED'){ const x=out.ns[m]||(out.ns[m]={n:0,amt:0}); x.n++; x.amt+=sub; nsN++; continue; }
        const M=out.months[m]||(out.months[m]={}), t=M[nm.key]||(M[nm.key]={done:0,voided:0,open:0,voidAmt:0,cv:0,cvAmt:0,reasons:{},sched:0,schedN:0,acq:0});
        t.sched+=sub; t.schedN++; // orders scheduled for the month (every order except not-started): the void % base
        const st=String(o['Status']||'').toLowerCase();
        if(reason==='CANCELED'){ t.cv++; t.cvAmt+=sub; cvN++; (out.cvLocs[m]||(out.cvLocs[m]=[])).push({k:nm.key,loc:idStr(o['Location Code']),svc:String(o['Service Code']??'').trim().toUpperCase(),d:ymd(dt)}); }
        else if(reason==='ACQ'){ t.acq++; } // acquisition voids: left out of void counts, like the company report
        else if((reason&&reason!=='N/A')||st.startsWith('void')){ const r=reason&&reason!=='N/A'?reason:'NO REASON'; t.voided++; t.voidAmt+=sub; t.reasons[r]=(t.reasons[r]||0)+1; vd++;
          (out.voidList[m]||(out.voidList[m]=[])).push({l:idStr(o['Location Code']),k:nm.key,r,s:String(o['Service Code']??'').trim().toUpperCase(),d:ymd(dt),a:Math.round(sub*100)/100}); }
        else if(st.startsWith('complet')){ t.done++; t.doneAmt=(t.doneAmt||0)+sub; done++; const ds=ymd(dt); if(ds.slice(0,7)===m&&(!out.asOf[m]||ds>out.asOf[m])) out.asOf[m]=ds; }
        else t.open++; }
      out.summary=`${done.toLocaleString()} completed, ${vd} voided and ${cvN} voided because the customer cancelled, in ${Object.keys(out.months).map(m=>monthName(m)).join(', ')}. ${nsN} not-started sales removed${dup?`; ${dup} repeated orders removed`:''}.`;
    }
    if(d.type==='open'){
      const counts={}; for(const o of objs){ const dt=toDate(o['Work Date']); if(dt){ const m=ym(dt); counts[m]=(counts[m]||0)+1; } }
      const m=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]; if(!m) continue;
      const M=out.months[m]={}; let n=0;
      const seenO=new Set();
      for(const o of objs){ if(!o['Order']||!toDate(o['Work Date'])) continue; const on=String(o['Order']).trim(); if(seenO.has(on)) continue; seenO.add(on); const code=String(o['Tech 1']||'UNASSIGNED').trim().toUpperCase();
        const t=M[code]||(M[code]={stops:0,prod:0}); t.stops++; t.prod+=num(o['Subtotal'])||0; n++; }
      out.summary=`${n.toLocaleString()} stops on the books for ${monthName(m)}. This sets the month’s starting stops.`;
    }
    return out;
  }
  return null;
}

/* ---------- upload ---------- */
function openUpload(){ state.pending=[]; $('#upFile').value=''; $('#fileList').innerHTML=''; $('#upStatus').textContent=''; $('#saveUp').disabled=true; $('#upDlg').showModal(); }
const TYPE_LBL={revenue:'Revenue history',backlog:'Sales backlog',plan:'FY budget plan',bv:'Business valuation',dor:'DOR sales budget',base:'Customer list',cancel:'Cancel detail',sales:'Sales details',route:'Route completion details',open:'Open orders',employees:'Employment list'};
// Power BI exports carry an "Applied filters" note: which branches and months the numbers cover
function noteBranches(note){ const m=note.match(/Branch(?:Name)?\s+is\s+([^\n]+)/i); return m?m[1].split(/,|\bor\b/i).map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z]{2,4}$/.test(x)):[]; }
function noteMonths(note){
  const MN=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  let months=[...note.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? (\d{4})\b/gi)].map(x=>x[2]+'-'+pad(MN.indexOf(x[1].slice(0,3).toLowerCase())+1));
  if(/current month/i.test(note)){ const last=months.sort().slice(-1)[0]; let cm=todayStr().slice(0,7);
    if(last){ const [y,mo]=last.split('-').map(Number); cm=mo===12?(y+1)+'-01':y+'-'+pad(mo+1); } months.push(cm); }
  months=[...new Set(months)].sort(); return months.length?months:[todayStr().slice(0,7)];
}
// Run a parse with another branch's settings (report code, location, name fixes) without switching the page
function withBranch(b,fn){ const prev=[BRANCH,LOCATION,ALIASES,FORCE_MAIN]; applyBranch(b); try{ return fn(); } finally{ [BRANCH,LOCATION,ALIASES,FORCE_MAIN]=prev; } }
function hasContent(p){
  if(!p) return false;
  if(p.type==='employees') return (p.employees||[]).length>0;
  if(p.type==='dor') return !!p.dor;
  if(p.type==='bv') return !!p.bv;
  if(p.type==='plan') return !!p.plan;
  if(p.type==='backlog') return Object.keys(p.backlog?.months||{}).length>0;
  if(p.type==='base') return (p.base?.branch?.setups||0)>0;
  return Object.keys(p.months||{}).length>0;
}
async function onFiles(files){
  const list=$('#fileList'), targets=CFG&&ADMIN?[...CFG.branches,...(CFG.district?[CFG.district]:[])]:[ME];
  for(const f of files){
    const item=document.createElement('div'); item.className='fileitem'; item.innerHTML=`<b>${esc(f.name)}</b><span class="sub">Reading…</span>`; list.appendChild(item);
    try{
      const buf=await f.arrayBuffer();
      const head=new TextDecoder('windows-1252').decode(buf.slice(0,4000));
      let parseFor;
      if(/Service Setup List/.test(head)){ const text=new TextDecoder('windows-1252').decode(buf); parseFor=()=>parseCustomerList(text,f); }
      else {
        if(!window.XLSX) throw new Error('The spreadsheet reader didn’t load. Check your connection and reopen the page.');
        const wb=XLSX.read(buf,{type:'array',cellDates:true});
        const first=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',raw:true,blankrows:false});
        if(first.slice(0,6).some(r=>r.some(c=>String(c).trim()==='Service Setup List'))){
          // a Service Setup List opened and saved in Excel: rebuild the tab-separated text the customer-list reader expects
          const cell=c=>Object.prototype.toString.call(c)==='[object Date]'?ymd(c).replace(/-/g,'/'):String(c??'');
          const text=first.map(r=>r.map(cell).join('\t')).join('\n'); parseFor=()=>parseCustomerList(text,f);
        } else parseFor=()=>parseReport(f,wb);
      }
      const found=[]; let recognized=false;
      for(const b of targets){ const p=withBranch(b,parseFor); if(p) recognized=true; if(hasContent(p)) found.push({branch:b.code,p}); }
      if(!recognized) throw new Error('Not recognized. Supported: customer list, cancel detail, sales details, route completion details, open orders, DOR sales budget and the employment list.');
      if(!found.length) throw new Error(`Recognized, but nothing in it belongs to ${targets.map(b=>b.code).join(', ')}. Check the branch filter on the export.`);
      state.pending=state.pending.filter(x=>!(x.p.file===f.name)).concat(found);
      const type=found[0].p.type;
      item.innerHTML=`<b>${esc(TYPE_LBL[type])}: ${esc(f.name)}</b>${found.map(x=>`<span class="sub"><b>${esc(x.branch)}</b> · ${esc(x.p.summary)}</span>`).join('')}`;
    }catch(e){ item.innerHTML=`<b>${esc(f.name)}</b><span class="status err">${esc(e.message||'That file couldn’t be read.')}</span>`; }
  }
  $('#saveUp').disabled=!state.pending.length;
}
// Apply parsed reports to the branch whose data is currently loaded into state
function applyPending(pending){
  const roster=JSON.parse(JSON.stringify(state.roster)); roster.codes=roster.codes||{}; roster.termedSeen=roster.termedSeen||{}; roster.show=roster.show||{};
  const touched={}, newBases={}; let newNames=null; const at=new Date().toISOString();
  const order=['employees','backlog','plan','bv','dor','base','cancel','sales','route','open'];
  for(const p of [...pending].sort((a,b)=>order.indexOf(a.type)-order.indexOf(b.type))){
    Object.assign(roster.codes,p.codes); Object.assign(roster.termedSeen,p.termedSeen);
    if(p.type==='employees'){ roster.employees=p.employees; roster.employeesFile=p.file; roster.employeesAt=at; continue; }
    if(p.type==='backlog'){ roster.backlog={...p.backlog,file:p.file,at}; continue; }
    if(p.type==='plan'){ roster.plans=roster.plans||{}; roster.plans[p.plan.year]=p.plan; continue; }
    if(p.type==='bv'){ roster.bv=roster.bv||{}; for(const m of p.bv.months) roster.bv[m]={total:p.bv.total,byClass:p.bv.byClass,file:p.file,at}; continue; }
    if(p.type==='dor'){ roster.dor=roster.dor||{}; const key=p.dor.months.length===1?p.dor.months[0]:'ytd'; roster.dor[key]={...p.dor,file:p.file,at}; continue; }
    if(p.type==='base'){ newBases[p.asOf]={...p.base,at}; newNames={asOf:p.asOf,names:p.locnames}; continue; }
    for(const [m,data] of Object.entries(p.months)){
      const d=touched[m]||(touched[m]=JSON.parse(JSON.stringify(state.months[m]||{})));
      d[p.type]=data; if(p.growth) d.growth=p.growth[m]||{}; if(p.spCancel) d.spCancel=p.spCancel[m]||{}; if(p.cancelLocs) d.cancelLocs=p.cancelLocs[m]||[]; if(p.cvLocs) d.routeCV=p.cvLocs[m]||[]; if(p.salesClass) d.salesClass=p.salesClass[m]||{}; if(p.cancelClass) d.cancelClass=p.cancelClass[m]||{}; if(p.cancelList) d.cancelList=p.cancelList[m]||[]; if(p.voidList) d.voidList=p.voidList[m]||[]; d.sources=d.sources||{}; d.sources[p.type]={file:p.file,at,...(p.asOf?.[m]?{asOf:p.asOf[m]}:{}),...(p.by?{by:p.by}:{}),...(p.ns?{ns:p.ns[m]||{n:0,amt:0}}:{})};
    }
  }
  if(newNames) state.locnames=newNames.names;
  state.roster=roster; Object.assign(state.months,touched); Object.assign(state.bases,newBases);
  return touched;
}
async function saveAll(){
  const st=$('#upStatus'), btn=$('#saveUp'); btn.disabled=true; st.className='status'; st.textContent='Saving…';
  try{
    const groups={}; for(const x of state.pending) (groups[x.branch]||(groups[x.branch]=[])).push(x.p);
    // a new backlog snapshot replaces every branch's backlog, even branches with nothing pending
    const blFile=state.pending.find(x=>x.p.type==='backlog');
    if(blFile&&CFG) for(const b of CFG.branches) if(!groups[b.code]?.some(p=>p.type==='backlog')) (groups[b.code]||(groups[b.code]=[])).push({type:'backlog',file:blFile.p.file,backlog:{months:{},asOf:blFile.p.backlog.asOf},codes:{},termedSeen:{}});
    const viewing=state.cur||ME.code; let viewTouched=null;
    for(const [code,list] of Object.entries(groups)){
      if(code!==state.cur){ stash(); activate(code); }
      const touched=applyPending(list); if(code===viewing) viewTouched=touched;
      state.dirtySet.add(code); state.dirty=true; stash();
    }
    if(state.cur!==viewing) activate(viewing);
    if(viewTouched){ const ms=Object.keys(viewTouched).sort(); const full=ms.filter(m=>viewTouched[m].cancel||viewTouched[m].sales||viewTouched[m].route); state.month=full.pop()||ms.pop()||state.month; }
    state.pending=[]; render(); $('#banner').innerHTML=bannerHTML();
    st.className='status ok'; st.textContent=`Saved for ${Object.keys(groups).join(', ')}. Publish when you’re ready.`;
  }catch(e){ console.error(e); btn.disabled=false; st.className='status err'; st.textContent='Something went wrong applying the reports. Nothing was published.'; }
}

/* ---------- wiring ---------- */
document.querySelectorAll('[data-sec]').forEach(b=>b.onclick=()=>{state.sec=b.dataset.sec;render();});
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;render();});
$('#monthSel').onchange=e=>{state.month=e.target.value;render();};
$('#uploadBtn').onclick=openUpload;
$('#upFile').onchange=e=>{ const fs=[...e.target.files]; if(fs.length) onFiles(fs); e.target.value=''; };
$('#saveUp').onclick=saveAll;
$('#presentBtn').onclick=()=>{ const on=document.body.classList.toggle('present'); $('#presentBtn').textContent=on?'Exit present':'Present';
  try{ if(on&&document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(()=>{}); else if(!on&&document.fullscreenElement) document.exitFullscreen(); }catch(e){} render(); };
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{ if(e.target===d) d.close(); }));
const drop=document.querySelector('.drop');
drop.addEventListener('dragover',e=>e.preventDefault());
drop.addEventListener('drop',e=>{ e.preventDefault(); const fs=[...e.dataTransfer.files]; if(fs.length) onFiles(fs); });

/* ---------- branches, data files, update mode, publishing ---------- */
let CFG=null, ME=null; // branches.json, and this page's branch
function applyBranch(b){ BRANCH=b.code; LOCATION=b.location||b.name; ALIASES=b.aliases||{}; FORCE_MAIN=b.forceMain||[]; }
function applyLook(b){
  const th=CFG?.themes?.[b.theme], root=document.documentElement.style;
  for(const k of ['brand','brand-soft','brand-ink','gold','good','mid','low','paper','line']) root.removeProperty('--'+k);
  // light background colors only apply in light mode, so dark mode keeps its own background
  const dark=document.documentElement.dataset.theme==='dark'||(document.documentElement.dataset.theme!=='light'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);
  if(th) for(const [k,v] of Object.entries(th)){ if(dark&&(k==='paper'||k==='line')) continue; root.setProperty('--'+k,v); }
  const tag=document.querySelector('.hero-tag'); if(tag) tag.textContent=b.code===DISTRICT_CODE?`${b.name} · month-end outlook`:`${b.name} route health`;
  document.title=`Bullseye Board · ${b.name}`;
  const mt=document.querySelector('meta[name="theme-color"]'); if(mt&&th?.brand) mt.content=th.brand;
}
function markDirty(){ state.dirty=true; (state.dirtySet||(state.dirtySet=new Set())).add(state.cur||BRANCH); }
function snapshot(){ return {version:1,at:state.dataAt,months:state.months,bases:state.bases,locnames:state.locnames,roster:state.roster}; }
function stash(){ if(state.cur&&state.boards) state.boards[state.cur]=snapshot(); }
function allUnits(){ return [...(CFG?.branches||[]),...(CFG?.district?[CFG.district]:[])]; }
function activate(code){ const b=allUnits().find(x=>x.code===code); applyBranch(b); state.cur=code; applyData(state.boards[code]||{}); }
function switchBranch(code){ if(code===state.cur) return; stash(); activate(code); applyLook(CFG.branches.find(x=>x.code===code)); state.month=null; render(); $('#branchSel').value=code; }
function bannerHTML(){
  if(ADMIN){
    const pend=[...(state.dirtySet||[])];
    return `<div class="banner">Update mode for every branch and the ${esc(CFG?.district?.name||'district')} board · numbers loaded from ${esc(state.loadedFrom||'the site')} at ${esc((state.loadedTime||new Date()).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}))} · now showing <b>${esc(CFG?allUnits().find(b=>b.code===state.cur)?.name||state.cur:BRANCH)}</b>. Upload reports here (they’re split by branch automatically), then <b>Publish all branches</b>.${pend.length?` <b>Not published yet: ${esc(pend.join(', '))}.</b>`:''}</div>`;
  }
  if(state.loadError) return `<div class="banner">Couldn’t load the board data. ${esc(state.loadError)}</div>`;
  return state.dataAt?`<div class="asof">Numbers as of ${esc(new Date(state.dataAt).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}))}</div>`:'';
}
function applyData(d){
  Object.assign(state,{months:d.months||{},bases:d.bases||{},locnames:d.locnames||{},
    roster:Object.assign({employees:null,codes:{},termedSeen:{},show:{}},d.roster||{})});
  state.dataAt=d.at||null; state.month=null;
  const g=state.roster.goals;
  if(g&&Object.keys(g).length&&!state.roster.budgets){
    state.roster.budgets={};
    for(const m of Object.keys(state.months).filter(m=>m>=START_MONTH)) state.roster.budgets[m]=JSON.parse(JSON.stringify(g));
  }
  delete state.roster.goals; delete state.roster.goalUnit;
}
function boardData(includeNames,d){
  d=d||snapshot();
  const months=JSON.parse(JSON.stringify(d.months||{}));
  if(!includeNames) for(const m of Object.values(months)) if(m.cancelList) m.cancelList=m.cancelList.map(x=>({...x,n:''}));
  return {version:1,at:new Date().toISOString(),months,bases:d.bases||{},locnames:includeNames?(d.locnames||{}):{},roster:d.roster||{}};
}
function download(name,blob){
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function loadScript(src){ return new Promise((ok,no)=>{ const sc=document.createElement('script'); sc.src=src; sc.onload=ok; sc.onerror=()=>no(new Error('Couldn’t load '+src)); document.head.appendChild(sc); }); }
function openHolidays(){
  const extra=(state.roster.holidays||[]).slice().sort();
  const fmtD=d=>new Date(d+'T12:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  $('#goalTitle').textContent='Company holidays';
  $('#goalBody').innerHTML=`
    <p class="sub">Holidays don’t count as workdays, so every pace (stops, cancels, voids and sales budgets) is measured over the remaining workdays. Changes here apply to every branch.</p>
    <h3>Built in (2026 calendar)</h3><p>${COMPANY_HOLIDAYS.map(fmtD).join(' · ')}</p>
    <h3>Added here</h3>
    <p class="sub">One date per line (YYYY-MM-DD), for example next year’s calendar.</p>
    <textarea id="holText" rows="8" style="width:100%;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--paper)">${extra.join('\n')}</textarea>
    <div class="actions"><button type="button" class="go" id="saveHol">Save holidays</button><span class="status" id="holStatus"></span></div>`;
  $('#saveHol').onclick=()=>{
    const raw=$('#holText').value.split(/[\s,;]+/).filter(Boolean), good=[], bad=[];
    for(const x of raw){ const d=toDate(x.length===10?x+'T12:00:00':x); if(d) good.push(ymd(d)); else bad.push(x); }
    if(bad.length){ $('#holStatus').className='status err'; $('#holStatus').textContent=`Couldn’t read: ${bad.join(', ')}`; return; }
    // holidays are company-wide: apply to every branch
    const hol=[...new Set(good)].sort(); const r=JSON.parse(JSON.stringify(state.roster)); r.holidays=hol; state.roster=r; markDirty();
    for(const [code,bd] of Object.entries(state.boards||{})){ if(code===state.cur) continue; bd.roster=bd.roster||{}; bd.roster.holidays=hol; state.dirtySet.add(code); }
    render(); $('#banner').innerHTML=bannerHTML(); $('#goalDlg').close();
  };
  $('#goalDlg').showModal();
}
/* --- publishing straight to GitHub (one commit for every branch that changed) --- */
const TOKEN_KEY='bullseye_github_key';
function getToken(){ try{ return localStorage.getItem(TOKEN_KEY)||''; }catch(e){ return ''; } }
function openTokenDialog(then){
  $('#goalTitle').textContent='GitHub publishing key';
  $('#goalBody').innerHTML=`
    <p>Paste the fine-grained personal access token for <b>${esc(CFG.repo)}</b> (Contents: Read and write). It’s saved only in this browser on this computer.</p>
    <input type="password" id="tokIn" autocomplete="off" placeholder="github_pat_…" value="${esc(getToken())}" style="width:100%;font:inherit;padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--paper)">
    <div class="actions"><button type="button" class="go" id="tokSave">Save key</button><button type="button" class="ghost" id="tokForget">Forget key</button><span class="status" id="tokStatus"></span></div>`;
  $('#tokSave').onclick=()=>{ const v=$('#tokIn').value.trim(); if(!v){ $('#tokStatus').className='status err'; $('#tokStatus').textContent='Paste the key first.'; return; } try{ localStorage.setItem(TOKEN_KEY,v); }catch(e){} $('#goalDlg').close(); if(then) then(); };
  $('#tokForget').onclick=()=>{ try{ localStorage.removeItem(TOKEN_KEY); }catch(e){} $('#tokIn').value=''; $('#tokStatus').className='status ok'; $('#tokStatus').textContent='Key removed from this browser.'; };
  $('#goalDlg').showModal();
}
async function gh(path,tok,opt={}){
  const r=await fetch('https://api.github.com/repos/'+CFG.repo+path,{...opt,headers:{Authorization:'Bearer '+tok,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(opt.body?{'Content-Type':'application/json'}:{})}});
  if(!r.ok){ const e=new Error('GitHub answered '+r.status); e.status=r.status; throw e; }
  return r.json();
}
async function ghRaw(path,tok){
  const r=await fetch(`https://api.github.com/repos/${CFG.repo}/contents/${path}?ref=${CFG.gitBranch||'main'}&t=${Date.now()}`,{headers:{Authorization:'Bearer '+tok,Accept:'application/vnd.github.raw','X-GitHub-Api-Version':'2022-11-28'},cache:'no-store'});
  if(r.status===404) return null; if(!r.ok){ const e=new Error('GitHub answered '+r.status); e.status=r.status; throw e; }
  return r.json();
}
async function publishAll(){
  const tok=getToken(); if(!tok) return openTokenDialog(publishAll);
  stash();
  const codes=[...(state.dirtySet||[])]; const st=$('#pubStatus');
  if(!codes.length){ st.className='status ok'; st.textContent='Nothing new to publish.'; return; }
  const btn=$('#publishBtn'); btn.disabled=true; st.className='status'; st.textContent=`Publishing ${codes.join(', ')}…`;
  const incl=$('#inclNames').checked, br=CFG.gitBranch||'main';
  try{
    // Safety check: never publish over numbers someone (or another open tab) published after this page loaded them
    const stale=[];
    for(const code of codes){ const b=allUnits().find(x=>x.code===code); const remote=await ghRaw(`${b.slug}/board.json`,tok);
      if(remote&&remote.at&&(!state.loadedAt?.[code]||remote.at>state.loadedAt[code])) stale.push(b.name); }
    if(stale.length){ st.className='status err'; st.textContent=`Newer numbers were published for ${stale.join(', ')} after this page loaded them, so nothing was published. Reload this page (Ctrl+Shift+R), upload your reports again, then publish.`; btn.disabled=false; return; }
    const stamp=new Date().toISOString();
    const ref=await gh('/git/ref/heads/'+br,tok), base=ref.object.sha, commit=await gh('/git/commits/'+base,tok);
    const tree=[];
    for(const code of codes){ const b=allUnits().find(x=>x.code===code);
      const data=boardData(incl,state.boards[code]); data.at=stamp;
      const blob=await gh('/git/blobs',tok,{method:'POST',body:JSON.stringify({content:JSON.stringify(data),encoding:'utf-8'})});
      tree.push({path:`${b.slug}/board.json`,mode:'100644',type:'blob',sha:blob.sha}); }
    const nt=await gh('/git/trees',tok,{method:'POST',body:JSON.stringify({base_tree:commit.tree.sha,tree})});
    const nc=await gh('/git/commits',tok,{method:'POST',body:JSON.stringify({message:`Update boards: ${codes.join(', ')} (${todayStr()})`,tree:nt.sha,parents:[base]})});
    await gh('/git/refs/heads/'+br,tok,{method:'PATCH',body:JSON.stringify({sha:nc.sha})});
    for(const code of codes) state.loadedAt[code]=stamp;
    state.dirtySet.clear(); state.dirty=false; $('#banner').innerHTML=bannerHTML();
    st.className='status ok'; st.textContent=`Published ${codes.join(', ')}. Pages update in a minute or two.`;
  }catch(e){
    st.className='status err';
    st.textContent=e.status===401?'GitHub didn’t accept the key. It may have expired; click GitHub key to paste a new one.':e.status===403||e.status===404?'The key can’t write to this repository. Check it has Contents: Read and write on '+CFG.repo+'.':e.status===409||e.status===422?'Someone else saved to the repository at the same moment. Click Publish again.':'Couldn’t reach GitHub. Check your connection and try again, or use Download all.';
  }finally{ btn.disabled=false; }
}
async function downloadAll(){
  stash(); const st=$('#pubStatus');
  try{ if(!window.JSZip) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const zip=new JSZip(), incl=$('#inclNames').checked;
    for(const b of allUnits()) zip.file(`${b.slug}/board.json`,JSON.stringify(boardData(incl,state.boards[b.code]||{})));
    download(`bullseye-boards-${todayStr()}.zip`,await zip.generateAsync({type:'blob'}));
    st.className='status ok'; st.textContent='Downloaded. Unzip and drag the branch folders into the repo on GitHub.';
  }catch(e){ st.className='status err'; st.textContent='Couldn’t build the download.'; }
}
function setupAdmin(){
  document.querySelectorAll('.adminbar').forEach(el=>el.hidden=false);
  if(!window.XLSX) loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js').catch(()=>{});
  const sel=$('#branchSel');
  sel.innerHTML=CFG.branches.map(b=>`<option value="${esc(b.code)}">${esc(b.name)} (${esc(b.code)})</option>`).join(''); sel.value=state.cur;
  sel.onchange=e=>switchBranch(e.target.value);
  $('#publishBtn').onclick=publishAll; $('#exportBtn').onclick=downloadAll; $('#tokenBtn').onclick=()=>openTokenDialog();
  $('#openJson').onclick=()=>$('#jsonFile').click();
  $('#holBtn').onclick=openHolidays;
  $('#jsonFile').onchange=async e=>{ const f=e.target.files[0]; if(!f) return; try{ applyData(JSON.parse(await f.text())); markDirty(); render(); $('#banner').innerHTML=bannerHTML(); }catch(err){ alert('That file isn’t a board.json export.'); } e.target.value=''; };
  for(const id of ['saveGoals']) document.addEventListener('click',ev=>{ if(ev.target&&ev.target.id===id) setTimeout(()=>{ markDirty(); $('#banner').innerHTML=bannerHTML(); },300); });
  window.addEventListener('beforeunload',e=>{ if(state.dirtySet&&state.dirtySet.size){ e.preventDefault(); e.returnValue=''; } });
}
async function init(){
  state.dirtySet=new Set();
  try{ const r=await fetch('../branches.json',{cache:'no-store'}); if(r.ok) CFG=await r.json(); }catch(e){}
  const code=String(window.BOARD_CODE||'TUC').toUpperCase();
  ME=allUnits().find(b=>b.code===code)||{code,slug:code.toLowerCase(),name:code,location:code};
  if(CFG?.district&&code===CFG.district.code){
    // District board: read every branch's published numbers, no upload tools
    DISTRICT=true; ADMIN=false; state.canEdit=false; applyBranch(ME); applyLook(ME); document.body.classList.add('district');
    document.querySelectorAll('#secSeg, [data-mode]').forEach(el=>{ const g=el.closest('.seg'); if(g) g.style.display='none'; });
    state.boards={};
    await Promise.all(allUnits().map(async b=>{ try{ const r=await fetch(`../${b.slug}/board.json`,{cache:'no-store'}); state.boards[b.code]=r.ok?await r.json():{}; }catch(e){ state.boards[b.code]={}; } }));
    state.cur=ME.code; activate(ME.code); render();
    let seen=Date.now(); document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&Date.now()-seen>10*60*1000) location.reload(); else if(document.visibilityState==='hidden') seen=Date.now(); });
    return;
  }
  applyBranch(ME); applyLook(ME);
  if(ADMIN&&(!CFG||CFG.admin!==ME.code)) ADMIN=false; // only the admin branch's page can update
  state.canEdit=ADMIN; state.cur=ME.code;
  if(ADMIN){
    state.boards={}; state.loadedAt={}; const tok=getToken(); state.loadedFrom=tok?'GitHub':'the site';
    await Promise.all(allUnits().map(async b=>{
      let d=null;
      if(tok){ try{ d=await ghRaw(`${b.slug}/board.json`,tok); }catch(e){ state.loadedFrom='the site'; } }
      if(!d){ try{ const r=await fetch(`../${b.slug}/board.json`,{cache:'no-store'}); d=r.ok?await r.json():{}; }catch(e){ d={}; } }
      state.boards[b.code]=d||{}; state.loadedAt[b.code]=d?.at||null; }));
    state.loadedTime=new Date();
    applyData(state.boards[ME.code]||{});
  } else {
    try{
      const r=await fetch('board.json',{cache:'no-store'});
      if(r.ok) applyData(await r.json());
      else if(r.status!==404) state.loadError=`The server answered ${r.status}.`;
    }catch(e){ state.loadError=location.protocol==='file:'?'Open the site through a web server (see README), not as a file.':'Check your connection and reload.'; }
  }
  render();
  if(ADMIN) setupAdmin();
  // Pick up a newer board.json when someone comes back to an open tab
  if(!ADMIN){ let seen=Date.now(); document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&Date.now()-seen>10*60*1000) location.reload(); else if(document.visibilityState==='hidden') seen=Date.now(); }); }
}
init();
})();
