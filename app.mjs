import {searchCoverage,examples,normalize,matchesCode} from './search.mjs';
import {emptyData,openStore,readStore,saveStore,download,decodeBackup,encodeBackup} from './storage.mjs';

const menus={home:'HOME',insurance:'MY INSURANCE',coverage:'COVERAGE',documents:'DOCUMENTS',claims:'CLAIMS',settings:'SETTINGS'};
const $=(selector,root=document)=>root.querySelector(selector);
const main=$('#main');
const modal=$('#dialog');
const dialogBody=$('#dialog-body');
const now=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const won=n=>n===null||n===undefined||n===''?'미확인':`${Number(n).toLocaleString('ko-KR')}원`;
const asArray=v=>Array.isArray(v)?v:[];
const clearKeys=(values,ids)=>values.filter(x=>!ids.has(x));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const template=(strings,...values)=>strings.reduce((out,s,i)=>out+s+(i<values.length?escape(values[i]):''),'');
const id=()=>globalThis.crypto.randomUUID();
const opts=(list,selected='',first='')=>`${first?`<option value="">${escape(first)}</option>`:''}${list.map(item=>{
  const [value,label]=Array.isArray(item)?item:[item,item];
  return `<option value="${escape(value)}"${String(value)===String(selected)?' selected':''}>${escape(label)}</option>`;
}).join('')}`;
const policyBy=id=>data.policies.find(p=>p.id===id);
const docBy=id=>data.documents.find(p=>p.id===id);
const coverageBy=id=>data.confirmed_coverages.find(p=>p.id===id);
const action=(name,label,value='',className='')=>template`<button type="button" data-action="${name}" data-id="${value}" class="${className}">${label}</button>`;
const heading=(title,copy='',actions='')=>`<div class="titlebar row"><div><h1>${escape(title)}</h1>${copy?`<p class="muted">${escape(copy)}</p>`:''}</div><div class="actions">${actions}</div></div>`;
const empty=(text)=>`<p class="card muted">${escape(text)}</p>`;
const badge=(text,cls='')=>template`<span class="badge ${cls}">${text}</span>`;
const list=(items)=>items.length?`<ul>${items.map(item=>template`<li>${item}</li>`).join('')}</ul>`:'';
const policyOptions=(selected='',first='보험 선택')=>opts(data.policies.map(p=>[p.id,`${p.insurer} · ${p.product}`]),selected,first);
const categories=['정액','실손의료','실손비용','실손재물','실손배상','부담보','관리'];
const causes=['질병','상해'];
const types=['통원','입원','검사','치료','진단','수술','처방','항암치료','부상등급','후유장해','사망','배상책임','벌금','형사합의비','변호사선임비','재물·비용·배상'];
const departments=['이비인후과','정형외과','내과','소화기내과','치과','산부인과','안과','신경과','신경외과','류마티스내과','응급의학과'];
const parts=['귀','머리','뇌','목','흉곽','척추','어깨','팔','손목','손가락','심장','위','대장','복부','유방','자궁','난소','골반','고관절','무릎','발목','발','치아'];
const claimStatuses=['미청구','청구 완료','지급 완료','지급 거절'];
const aDate=()=>`<label>진료·사고일<input name="date" type="date" value="${escape(home.date||'')}"></label>`;
let data=emptyData(), db, page='home', ready=false, toastTimer, busy=false, pdfState;
let home={}, group='all', filter={}, docQuery='', docMatches=[], claimFilters={};
let initialInstall;

function notify(message) {
  $('#toast').textContent=message;
  $('#toast').hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('#toast').hidden=true,4800);
}
function errorText(error) {
  return error?.name==='QuotaExceededError'?'브라우저 저장 공간이 부족해요. 불필요한 파일을 정리하고 다시 시도해 주세요.':error?.message||'작업 중 오류가 발생했어요.';
}
function via(task) {
  return Promise.resolve().then(task).catch(error=>notify(errorText(error)));
}
async function save(next,options) {
  await saveStore(db,next,options);
  data=next;
}
function openDialog(title,content) {
  dialogBody.innerHTML=`<div class="dialog-head"><h2>${escape(title)}</h2>${action('close-dialog','닫기')}</div>${content}`;
  if (!modal.open) modal.showModal();
}
modal.addEventListener('close',()=>{
  const old=pdfState;
  pdfState=null;
  if (old?.document) old.document.destroy().catch(()=>{});
});
function go(target) {
  if (location.hash===`#${target}`) render();
  else location.hash=target;
}
function route() {
  const section=location.hash.slice(1);
  if (section==='main') return;
  page=Object.hasOwn(menus,section)?section:'home';
  render();
  window.scrollTo(0,0);
}
function sourceButtons(row) {
  const sources=[...asArray(row.sources),...(row.claim_common_source?[row.claim_common_source]:[])];
  if (!sources.length) return '<p class="muted">등록된 근거 자료가 없어요.</p>';
  return `<div class="source-list">${sources.filter(v=>v&&typeof v==='object').map(v=>{
    const doc=docBy(v.document_id);
    const pages=asArray(v.pdf_pages);
    const label=`${doc?.title||v.file_name||'근거 PDF'}${pages.length?` · PDF ${pages.join(', ')}쪽`:''}${v.clause?` · ${v.clause}`:''}`;
    return `<div>${action('view-source',label,`${v.document_id}/${pages[0]||1}`)} <span class="muted">${escape(v.file_name||doc?.file_name||'')}</span></div>`;
  }).join('')}</div>`;
}
function moreCoverage(r) {
  const fields=[['적용 기간',[r.insured_period_start,r.insured_period_end,r.insured_period_text].filter(Boolean).join(' · ')],
    ['담보 보험료',r.premium_krw!=null?won(r.premium_krw):null],['납입기간',r.payment_years?`${r.payment_years}년`:null],
    ['지급 횟수·한도',r.limit],['면책기간',r.waiting_period],['감액기간',r.reduction_period],['제외사항',r.exclusions],['추가 확인',r.note],
    ['질병분류코드',asArray(r.kcd_codes).join(', ')]];
  const rows=fields.filter(([,value])=>value).map(([label,value])=>template`<tr><th scope="row">${label}</th><td>${value}</td></tr>`).join('');
  return `${rows?`<div class="table-wrap"><table><tbody>${rows}</tbody></table></div>`:''}
    <p class="muted">청구 시 확인할 서류</p>${asArray(r.claim_document_candidates).length?list(r.claim_document_candidates):'<p class="muted">보험사에 해당 청구 유형의 필요 서류를 확인해 주세요.</p>'}
    <p class="muted">근거 문서</p>${sourceButtons(r)}`;
}
function resultCard(item) {
  const {row:r,policy:p,verdict,detail,questions}=item;
  const cls=verdict==='보장 제외 확인'?'excluded':verdict==='지급 조건 충족 가능'?'good':'';
  return `<article class="card candidate">
    <div class="row">${badge(verdict,cls)}<span class="muted">${escape(r.reimbursement_kind)}</span></div>
    <div class="result-body"><p class="muted">${escape(p.insurer)} · ${escape(p.product)}</p><h3>${escape(r.name)}</h3>
    <p>${escape(r.payment_rule||'지급액 산정 기준 확인 필요')}</p>
    ${detail?template`<p class="notice">${detail}</p>`:''}${list(questions)}
    <details><summary>한도·제외사항·청구서류·근거</summary><div class="result-body">${moreCoverage(r)}</div></details>
    </div></article>`;
}
function homeView() {
  const inputs=`<div class="grid filter-grid">
    <label>진료과목<select name="department">${opts(departments,home.department,'전체')}</select></label>
    <label>신체 부위<select name="part">${opts(parts,home.part,'전체')}</select></label>
    <label>질병·상해<select name="cause">${opts(causes,home.cause,'전체')}</select></label>
    <label>치료 유형<select name="type">${opts(types,home.type,'전체')}</select></label>
    <label>질병분류코드<input name="code" value="${escape(home.code||'')}" placeholder="예 S62.6"></label>${aDate()}
    </div>`;
  const have=!!data.policies.length;
  return `${have?'':`<div class="notice row"><span>개인 보험 자료를 가져오면 가입 담보 기준으로 검색할 수 있어요.</span>${action('restore','자료 가져오기','','primary')}</div>`}
  <section class="hero"><h1>보험금 찾아보기</h1><p>어떤 진료를 받았거나 어떤 사고가 있었나요?</p>
    <form id="search-form"><div class="searchbar"><input name="query" aria-label="진료 또는 사고 내용" placeholder="예 이비인후과에서 청력검사를 받았어" value="${escape(home.query||'')}" maxlength="300"><button class="primary">검색</button></div>
      <details class="filters"${Object.keys(home).some(k=>k!=='query'&&home[k])?' open':''}><summary>진료과목·신체 부위·사고일 선택</summary>${inputs}</details>
    </form><div class="jump" aria-label="검색 예시">${examples.map((s,i)=>action('example',s,String(i),'chip')).join('')}</div>
  </section><div id="search-results" class="section" aria-live="polite"></div>`;
}
function updateResults() {
  const root=$('#search-results');
  if (!root) return;
  if (!Object.values(home).some(Boolean)) {root.replaceChildren();return;}
  const {results,unresolved}=searchCoverage(data,home);
  const pending=results.filter(r=>r.verdict==='추가 확인 필요').length;
  const good=results.filter(r=>r.verdict==='지급 조건 충족 가능').length;
  const excluded=results.length-pending-good;
  const groups=[['all',`전체 ${results.length}`],['지급 조건 충족 가능',`조건 충족 가능 ${good}`],['추가 확인 필요',`추가 확인 ${pending}`],['보장 제외 확인',`제외 ${excluded}`]];
  const visible=results.filter(r=>group==='all'||r.verdict===group);
  root.innerHTML=`<h2>청구 검토 결과</h2>
    <p class="muted">검색은 가입 내역과 입력한 조건을 대조합니다. 최종 지급은 사고일의 유효 계약과 보험사 심사에서 결정돼요.</p>
    ${results.length?`<div class="tabs">${groups.map(([key,label])=>template`<button type="button" data-action="result-group" data-id="${key}" aria-pressed="${key===group}">${label}</button>`).join('')}</div>`:''}
    ${visible.length?`<div class="stack">${visible.map(resultCard).join('')}</div>`:empty(data.policies.length?'이 조건에서 찾은 담보가 없어요. 진단명·치료 유형 또는 질병분류코드로 다시 검색할 수 있어요.':'보험 데이터를 먼저 가져와 주세요.')}
    ${unresolved.length?`<div class="card section"><h3>가입 담보 자료가 더 필요한 계약</h3>${list(unresolved.map(p=>`${p.insurer} · ${p.product} — ${asArray(p.missing)[0]||'가입 담보 확인'}`))}</div>`:''}`;
}

const monthly=p=>String(p.premium_frequency||'월납')==='연납'?Number(p.premium_krw)/12:Number(p.premium_krw);
function insuranceView() {
  const live=data.policies.filter(p=>['정상','유지(정상)'].includes(p.status));
  const known=live.filter(p=>typeof p.premium_krw==='number' && ['월납','연납'].includes(p.premium_frequency));
  const sum=known.reduce((n,p)=>n+monthly(p),0);
  return heading('내 보험','계약 기간, 보험료, 실제 가입 담보를 확인해요.',action('edit-policy','보험 추가','','primary'))+
  `<div class="grid stats"><div class="card"><span class="muted">정상 계약</span><span class="metric">${live.length}건</span></div>
  <div class="card"><span class="muted">확인된 월 환산 보험료 · ${known.length}건</span><span class="metric">${escape(known.length?won(Math.round(sum)):'미확인')}</span></div>
  <div class="card"><span class="muted">확인된 연 환산 보험료</span><span class="metric">${escape(known.length?won(Math.round(sum*12)):'미확인')}</span></div></div>
  ${live.length>known.length?`<p class="muted notice">보험료 미확인 ${live.length-known.length}건은 합계에서 제외했어요. 실제 납부 주체와 완납 여부는 계약별로 확인해 주세요.</p>`:''}
  <div class="grid cards2 section">${data.policies.length?data.policies.map(p=>`<article class="card"><div class="row">${badge(p.status,p.status==='정상'?'good':'')}<span class="muted">${escape(p.insurer)}</span></div>
  <h3 class="result-body">${escape(p.product)}</h3><p class="muted">${escape(p.coverage_start||'시작일 미확인')} ~ ${escape(p.coverage_end||'종료일 미확인')} · ${escape(p.holder_role||'관계 미확인')}</p>
  <p><strong>${escape(won(p.premium_krw))}</strong> ${escape(p.premium_frequency||'')}</p><p class="muted">${escape(p.personal_riders_status||'')} · 담보 ${data.confirmed_coverages.filter(c=>c.policy_id===p.id).length}개</p>
  <div class="actions">${action('policy-detail','상세 보기',p.id)}${action('edit-policy','수정',p.id)}${action('delete-policy','삭제',p.id,'danger')}</div></article>`).join(''):empty('아직 등록된 보험이 없어요.')}</div>`;
}
function coverageView() {
  const {query='',policy='',kind='',type='',part='',department=''}=filter;
  const selected=data.confirmed_coverages.filter(c=>{
    const term=[c.name,c.payment_rule,c.cause,...asArray(c.kcd_codes),...asArray(c.related_departments),...asArray(c.body_parts)].join(' ');
    const code=query.toUpperCase().match(/^[A-Z]\d{2}(?:\.\d+)?$/)?.[0];
    return (!query||normalize(term).includes(normalize(query))||code&&asArray(c.kcd_codes).some(entry=>matchesCode(code,entry))) &&
      (!policy||c.policy_id===policy) && (!kind||c.reimbursement_kind===kind) && (!type||asArray(c.benefit_types).includes(type)) &&
      (!part||asArray(c.body_parts).includes(part)) && (!department||asArray(c.related_departments).includes(department));
  });
  return heading('보장 내역','실제 가입한 담보를 검색하고 중복 보장 조건을 비교해요.',action('edit-coverage','담보 추가','','primary'))+
    `<form class="card" id="coverage-form"><div class="searchbar"><input name="query" aria-label="담보 또는 질병 검색" value="${escape(query)}" placeholder="담보명, 질병, 분류코드"><button class="primary">검색</button></div>
    <div class="grid filter-grid"><label>보험<select name="policy">${policyOptions(policy,'전체')}</select></label>
    <label>보상 유형<select name="kind">${opts(categories,kind,'전체')}</select></label>
    <label>치료 유형<select name="type">${opts(types,type,'전체')}</select></label>
    <label>신체 부위<select name="part">${opts(parts,part,'전체')}</select></label>
    <label>진료과목<select name="department">${opts(departments,department,'전체')}</select></label></div></form>
    ${asArray(data.overlap_review).length?`<details class="card section"><summary>중복 보장 검토</summary><div class="result-body">${data.overlap_review.map(item=>`<h3>${escape(item.case)} · ${escape(item.payment_kind)}</h3><p>${escape(item.logic)}</p>${list(asArray(item.coverage_ids).map(coverageBy).filter(Boolean).map(r=>`${policyBy(r.policy_id)?.insurer||''} · ${r.name} · ${won(r.sum_insured_krw)}`))}`).join('')}</div></details>`:''}
    <h2 class="section">가입 담보 ${selected.length}개</h2><div class="stack">${selected.length?selected.map(coverageSummary).join(''):empty('선택한 조건의 담보가 없어요.')}</div>
    ${asArray(data.terms_only_catalog).length?`<details class="card section"><summary>상품 약관에 있는 미가입·미확인 항목</summary><div class="result-body">${data.terms_only_catalog.map(r=>`<h3>${escape(r.title)}</h3><p>${escape(r.terms_summary)}</p>${sourceButtons({sources:[r.source]})}`).join('')}</div></details>`:''}`;
}
function coverageSummary(c) {
  return `<details class="card compact"><summary>${escape(c.name)} · ${escape(won(c.sum_insured_krw))}</summary><div class="result-body">
  <p class="muted">${escape(policyBy(c.policy_id)?.insurer||'')} · ${escape(c.reimbursement_kind||'')} · ${escape(c.rule_status||'')}</p>
  <p>${escape(c.payment_rule||'')}</p>${moreCoverage(c)}
  <div class="actions">${action('edit-coverage','수정',c.id)}${action('delete-coverage','삭제',c.id,'danger')}</div></div></details>`;
}
function documentsView() {
  const docs=data.documents.filter(d=>!d.duplicate_of||!docBy(d.duplicate_of));
  return heading('보험 자료실','PDF 원본 열람과 본문 검색',action('add-pdfs','PDF 등록','','primary'))+
    `<form id="documents-form" class="card"><div class="searchbar"><input name="query" aria-label="PDF 본문 검색" placeholder="파일명 또는 PDF 본문 검색" value="${escape(docQuery)}"><button class="primary">검색</button></div></form>
    <div id="document-results" class="section">${docQuery?documentMatches():''}</div>
    <h2>등록 자료 ${docs.length}개</h2><div class="grid cards2">${docs.length?docs.map(d=>`<article class="card"><div class="row">${badge(d.kind||'PDF')}<span class="muted">${d.has_pdf?'원본 저장됨':'원본 추가 필요'}</span></div>
     <h3 class="result-body">${escape(d.title||d.file_name)}</h3><p class="muted">${escape(d.file_name)} ${d.pdf_pages?`· ${escape(d.pdf_pages)}쪽`:''}</p>
     ${list(asArray(d.related_policy_ids).map(id=>policyBy(id)?.product).filter(Boolean))}
     <div class="actions">${action('view-source','열람',`${d.id}/1`)}${action('edit-document','수정·연결',d.id)}${action('replace-pdf','원본 교체',d.id)}${action('delete-document','삭제',d.id,'danger')}</div></article>`).join(''):empty('등록된 보험 자료가 없어요.')}</div>`;
}
function documentMatches() {
  return `<h2>본문·파일 검색</h2>${docMatches.length?`<div class="stack">${docMatches.map(hit=>`<article class="card compact"><div class="row"><strong>${escape(hit.title)}${hit.page?escape(` · PDF ${hit.page}쪽`):''}</strong>${action('view-source','열람',`${hit.id}/${hit.page||1}`)}</div><p class="muted">${escape(hit.snippet)}</p></article>`).join('')}</div>`:empty('검색어가 포함된 자료를 찾지 못했어요.')}`;
}
function claimsView() {
  const yearOf=r=>(r.status==='지급 완료' && r.received_date || r.date || '').slice(0,4);
  const years=[...new Set(data.claims.map(yearOf).filter(Boolean))].sort().reverse();
  const insurers=[...new Set(data.claims.map(r=>r.insurer).filter(Boolean))].sort();
  const chosen=data.claims.filter(r=>(!claimFilters.year||yearOf(r)===claimFilters.year)&&(!claimFilters.insurer||r.insurer===claimFilters.insurer)&&(!claimFilters.status||r.status===claimFilters.status));
  const paid=chosen.filter(r=>r.status==='지급 완료');
  const totals=new Map();
  for (const r of paid) {
    const key=`${yearOf(r)||'일자 미기재'} · ${r.insurer||'보험사 미기재'}`;
    totals.set(key,(totals.get(key)||0)+Number(r.received||0));
  }
  return heading('보험금 청구 기록','진료비와 청구 상태, 실제 수령액을 기록해요.',action('edit-claim','청구 기록 추가','','primary'))+
    `<form id="claims-filter" class="card grid filter-grid"><label>연도<select name="year">${opts(years,claimFilters.year,'전체')}</select></label>
    <label>보험사<select name="insurer">${opts(insurers,claimFilters.insurer,'전체')}</select></label>
    <label>상태<select name="status">${opts(claimStatuses,claimFilters.status,'전체')}</select></label></form>
    <div class="card section"><div class="row"><div><span class="muted">선택한 기록의 실제 수령액</span><div class="metric">${won(paid.reduce((n,r)=>n+Number(r.received||0),0))}</div></div><span class="muted">지급 완료 ${paid.length}건</span></div>
    ${totals.size?`<p class="muted">수령일이 없으면 진료일의 연도로 집계합니다.</p><div class="table-wrap"><table><tbody>${Array.from(totals,([k,n])=>template`<tr><th scope="row">${k}</th><td>${won(n)}</td></tr>`).join('')}</tbody></table></div>`:''}</div>
    <div class="stack section">${chosen.length?chosen.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(r=>`<article class="card"><div class="row">${badge(r.status,r.status==='지급 완료'?'good':'')}<span class="muted">${escape(r.date)}${r.received_date?escape(` · 수령 ${r.received_date}`):''}</span></div>
    <h3 class="result-body">${escape(r.description||r.hospital||'진료 기록')}</h3><p class="muted">${escape([r.hospital,r.insurer,r.rider].filter(Boolean).join(' · '))}</p>
    <p class="muted">진료비 ${escape(won(r.expense))} · 청구 ${escape(won(r.requested))} · 수령 ${escape(won(r.received))}</p>
    <div class="actions">${action('edit-claim','수정',r.id)}${action('delete-claim','삭제',r.id,'danger')}</div></article>`).join(''):empty('선택한 조건의 청구 기록이 없어요.')}</div>`;
}
function settingsView() {
  return heading('설정','보험 자료와 기록은 현재 브라우저에 저장돼요.')+
    `<div class="stack"><section class="card"><h2>백업·복원</h2><p class="muted">브라우저 데이터를 지우거나 기기를 바꾸기 전에 백업해 주세요. ZIP에는 등록된 PDF 원본도 포함돼요.</p>
    <div class="actions">${action('backup-zip','PDF 포함 백업','','primary')}${action('backup-json','JSON 내보내기')}${action('restore','가져오기·복원')}</div></section>
    <section class="card"><h2>저장 공간</h2><p id="quota" class="muted">브라우저별 남은 공간을 확인하고 있어요.</p><p class="muted">파일 개수 제한은 없어요. 저장 가능한 양은 기기와 브라우저에 따라 달라요.</p>${action('persist','저장 공간 보존 요청')}</section>
    <section class="card"><h2>보험 데이터 관리</h2><div class="actions"><a class="button" href="#insurance">보험 추가·수정</a><a class="button" href="#coverage">담보 추가·수정</a></div>
    ${data.open_items.length?`<details class="result-body"><summary>추가 확인이 필요한 계약 자료</summary>${list(data.open_items.map(item=>`${asArray(item.policy_ids).map(id=>policyBy(id)?.insurer).filter(Boolean).join(', ')} · ${item.item||''}`))}</details>`:''}</section>
    <section class="card"><h2>데이터 초기화</h2><p class="muted">현재 앱의 보험, 원본 PDF, 청구 기록과 검색 자료를 지워요.</p>${action('reset','초기화','','danger')}</section></div>`;
}
function render() {
  if (!ready) return;
  $('#navigation').innerHTML=Object.entries(menus).map(([key,label])=>`<a href="#${key}"${page===key?' aria-current="page"':''}>${label}</a>`).join('');
  const views={home:homeView,insurance:insuranceView,coverage:coverageView,documents:documentsView,claims:claimsView,settings:settingsView};
  main.innerHTML=views[page]();
  if (page==='home') updateResults();
  if (page==='settings') storageUsage();
}
async function storageUsage() {
  const target=$('#quota');
  try {
    const usage=await navigator.storage?.estimate?.();
    if (target?.isConnected) target.textContent=usage?.quota?`현재 사이트 사용량 약 ${(usage.usage/1048576).toFixed(1)}MB / 브라우저 할당량 약 ${(usage.quota/1048576).toFixed(0)}MB`:'이 브라우저에서는 저장 공간 수치를 확인하기 어려워요.';
  } catch {if (target?.isConnected) target.textContent='브라우저가 저장 공간 수치를 제공하지 않아요.';}
}

const tplInput=(label,name,value='',attrs='')=>`<label>${escape(label)}<input name="${escape(name)}" value="${escape(value??'')}" ${attrs}></label>`;
const tplArea=(label,name,value='')=>`<label class="wide">${escape(label)}<textarea name="${escape(name)}">${escape(value??'')}</textarea></label>`;
const tplSelect=(label,name,options)=>`<label>${escape(label)}<select name="${escape(name)}">${options}</select></label>`;
function openForm(title,formName,key,fields) {
  openDialog(title,`<form id="${formName}" data-id="${escape(key||'')}" class="form-grid">${fields}<div class="wide"><button class="primary">저장</button></div></form>`);
}
function editPolicy(key) {
  const p=policyBy(key)||{};
  openForm(key?'보험 수정':'보험 추가','edit-policy-form',key,
    tplInput('보험사','insurer',p.insurer,'required')+tplInput('상품명','product',p.product,'required')+
    tplInput('가입일','contract_date',p.contract_date,'type="date"')+tplInput('보장 시작일','coverage_start',p.coverage_start,'type="date"')+
    tplInput('보장 종료일 또는 종신','coverage_end',p.coverage_end,'placeholder="YYYY-MM-DD 또는 종신"')+
    tplInput('상태 확인일','status_as_of',p.status_as_of,'type="date"')+tplSelect('계약 상태','status',opts(['정상','해지','만기','소멸','미확인'],p.status==='유지(정상)'?'정상':p.status||'정상'))+
    tplSelect('계약 관계','holder_role',opts(['계약자·피보험자','계약자','피보험자'],p.holder_role,'미확인'))+
    tplInput('납입기간(년)','payment_years',p.payment_years,'type="number" min="0" max="150"')+
    tplInput('회차별 보험료(원)','premium_krw',p.premium_krw,'type="number" min="0" max="99999999999"')+
    tplSelect('납입 주기','premium_frequency',opts(['월납','연납','일시납'],p.premium_frequency,'미확인'))+
    tplArea('추가 확인 사항','missing',asArray(p.missing).join('\n')));
}
function policyDetail(key) {
  const p=policyBy(key);
  if (!p) return;
  const info=[['보험사',p.insurer],['가입일',p.contract_date],['보험기간',[p.coverage_start,p.coverage_end].filter(Boolean).join(' ~ ')],['계약 상태',p.status],['상태 확인일',p.status_as_of],['계약 관계',p.holder_role],['납입기간',p.payment_years&&`${p.payment_years}년`],['보험료',[won(p.premium_krw),p.premium_frequency].filter(Boolean).join(' ')]];
  const details=info.map(([key,value])=>template`<tr><th scope="row">${key}</th><td>${value||'미확인'}</td></tr>`).join('');
  const rows=data.confirmed_coverages.filter(c=>c.policy_id===key);
  openDialog(p.product,`<div class="table-wrap"><table><tbody>${details}</tbody></table></div>
  ${list([p.coverage_end_explanation,p.premium_scope_note,...asArray(p.missing)].filter(Boolean))}
  <div class="actions section">${action('edit-policy','보험 수정',key)}${action('add-linked-coverage','담보 추가',key)}</div>
  <h3 class="section">가입 근거</h3>${sourceButtons(p)}
  <h3 class="section">가입 담보 ${rows.length}개</h3><div class="stack">${rows.length?rows.map(coverageSummary).join(''):empty('가입 담보 상세 내역을 추가할 수 있어요.')}</div>`);
}
function editCoverage(key,policy='') {
  if (!data.policies.length) {editPolicy('');return;}
  const c=coverageBy(key)||{};
  openForm(key?'담보 수정':'담보 추가','edit-coverage-form',key,
    tplSelect('보험','policy_id',policyOptions(c.policy_id||policy||data.policies[0].id))+
    tplInput('담보명','name',c.name,'required')+
    tplSelect('보상 유형','reimbursement_kind',opts(categories,c.reimbursement_kind||'정액'))+
    tplSelect('질병·상해','cause',opts(['질병','상해','질병·상해','질병·재해','교통상해','교통사고'],c.cause,'미확인'))+
    tplInput('가입금액(원)','sum_insured_krw',c.sum_insured_krw,'type="number" min="0"')+
    tplInput('담보 보험료(원)','premium_krw',c.premium_krw,'type="number" min="0"')+
    tplInput('보장 시작일','insured_period_start',c.insured_period_start,'type="date"')+
    tplInput('보장 종료일 또는 종신','insured_period_end',c.insured_period_end)+
    tplInput('기간 설명','insured_period_text',c.insured_period_text)+tplInput('납입기간(년)','payment_years',c.payment_years,'type="number" min="0"')+
    tplInput('치료 유형(쉼표로 구분)','benefit_types',asArray(c.benefit_types).join(', '))+
    tplInput('질병분류코드(쉼표로 구분)','kcd_codes',asArray(c.kcd_codes).join(', '))+
    tplInput('신체 부위(쉼표로 구분)','body_parts',asArray(c.body_parts).join(', '))+
    tplInput('진료과목(쉼표로 구분)','related_departments',asArray(c.related_departments).join(', '))+
    tplArea('지급 조건 및 금액 산정','payment_rule',c.payment_rule)+tplArea('한도·횟수','limit',c.limit)+
    tplInput('면책기간','waiting_period',c.waiting_period)+tplInput('감액기간','reduction_period',c.reduction_period)+
    tplArea('제외사항','exclusions',c.exclusions)+tplArea('청구서류(한 줄에 하나)','claim_document_candidates',asArray(c.claim_document_candidates).join('\n'))+
    tplSelect('추가 근거 PDF','source_id',opts(data.documents.filter(doc=>!doc.duplicate_of).map(doc=>[doc.id,doc.title||doc.file_name]),'','선택 안 함'))+
    tplInput('근거 PDF 쪽수','source_page','','type="number" min="1"')+tplInput('근거 조항','source_clause'));
}
function editDoc(key) {
  const doc=docBy(key);
  if (!doc) return;
  const related=asArray(doc.related_policy_ids);
  openForm('자료 수정·보험 연결','edit-document-form',key,
    tplInput('자료 제목','title',doc.title,'required')+tplSelect('자료 종류','kind',opts(['보험증권','가입 상세','상품 약관','개별 특약 약관','가입 조회서','상품요약서','기타 PDF'],doc.kind||'기타 PDF'))+
    `<label class="wide">연결할 보험(여러 개 선택 가능)<select name="policy_ids" multiple size="${Math.min(7,Math.max(2,data.policies.length))}">${data.policies.map(p=>`<option value="${escape(p.id)}"${related.includes(p.id)?' selected':''}>${escape(p.insurer)} · ${escape(p.product)}</option>`).join('')}</select></label>`);
}
function editClaim(key) {
  const c=data.claims.find(x=>x.id===key)||{};
  const insurers=[...new Set(data.policies.map(p=>p.insurer))];
  const riders=data.confirmed_coverages.filter(r=>!c.insurer||policyBy(r.policy_id)?.insurer===c.insurer);
  openForm(key?'청구 기록 수정':'청구 기록 추가','edit-claim-form',key,
    tplInput('진료일','date',c.date||now(),'type="date" required')+tplInput('병원명','hospital',c.hospital)+
    tplArea('진료 내용','description',c.description)+
    tplInput('청구 보험사','insurer',c.insurer,'list="claim-insurers"')+`<datalist id="claim-insurers">${opts(insurers)}</datalist>`+
    tplInput('청구 특약','rider',c.rider,'list="claim-riders"')+`<datalist id="claim-riders">${opts(riders.map(r=>r.name))}</datalist>`+
    tplInput('진료비(원)','expense',c.expense,'type="number" min="0"')+
    tplInput('청구 금액(원)','requested',c.requested,'type="number" min="0"')+
    tplInput('실제 수령 금액(원)','received',c.received,'type="number" min="0"')+
    tplInput('수령일','received_date',c.received_date,'type="date"')+
    tplSelect('상태','status',opts(claimStatuses,c.status||'미청구'))+
    tplArea('메모','note',c.note));
}
function fieldValues(form) {
  return Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,String(v).trim()]));
}
const numeric=value=>value===''||value==null?null:Number(value);
const split=(value,pattern=/[,\n]/)=>String(value||'').split(pattern).map(t=>t.trim()).filter(Boolean);
const replaceRow=(list,row)=>list.some(r=>r.id===row.id)?list.map(r=>r.id===row.id?row:r):[...list,row];
async function submitEdit(form) {
  const x=fieldValues(form);
  const key=form.dataset.id||id();
  let next;
  if (form.id==='edit-policy-form') {
    if (x.coverage_end && x.coverage_end!=='종신' && (!/^\d{4}-\d{2}-\d{2}$/.test(x.coverage_end)||!Number.isFinite(Date.parse(x.coverage_end)))) throw new Error('보장 종료일은 YYYY-MM-DD 또는 종신으로 입력해 주세요.');
    if (x.coverage_start && x.coverage_end && x.coverage_end!=='종신' && x.coverage_start>x.coverage_end) throw new Error('보장 종료일은 시작일 이후로 입력해 주세요.');
    const old=policyBy(key);
    const row={...old,...x,id:key,missing:split(x.missing,/\n/),premium_krw:numeric(x.premium_krw),payment_years:numeric(x.payment_years),
      personal_riders_status:old?.personal_riders_status||'상세 가입자료 필요'};
    next={...data,policies:replaceRow(data.policies,row)};
  } else if (form.id==='edit-coverage-form') {
    if (!policyBy(x.policy_id)) throw new Error('연결된 보험을 선택해 주세요.');
    const old=coverageBy(key);
    const {source_id,source_page,source_clause,...fields}=x;
    const doc=docBy(source_id);
    if (doc?.pdf_pages && Number(source_page)>doc.pdf_pages) throw new Error('자료에 있는 PDF 쪽수를 입력해 주세요.');
    const sources=[...asArray(old?.sources)];
    if (doc) sources.push({document_id:doc.id,file_name:doc.file_name,pdf_pages:[Number(source_page)||1],clause:source_clause});
    const row={...old,...fields,id:key,sources,enrollment_status:old?.enrollment_status||'사용자 등록',rule_status:old?.rule_status||'사용자 입력'};
    for (const name of ['benefit_types','kcd_codes','body_parts','related_departments','claim_document_candidates']) row[name]=split(x[name],name==='claim_document_candidates'?/\n/:undefined);
    for (const name of ['sum_insured_krw','premium_krw','payment_years']) row[name]=numeric(x[name]);
    const p=policyBy(x.policy_id);
    next={...data,confirmed_coverages:replaceRow(data.confirmed_coverages,row),policies:replaceRow(data.policies,{...p,personal_riders_status:p.personal_riders_status==='상세 가입자료 필요'?'일부 담보 등록':p.personal_riders_status})};
  } else if (form.id==='edit-document-form') {
    const old=docBy(key);
    if (!old) return;
    next={...data,documents:replaceRow(data.documents,{...old,title:x.title,kind:x.kind,related_policy_ids:new FormData(form).getAll('policy_ids')})};
  } else {
    const row={...x,id:key,expense:numeric(x.expense),requested:numeric(x.requested),received:numeric(x.received)};
    next={...data,claims:replaceRow(data.claims,row)};
  }
  await save(next);
  modal.close();
  render();
  notify('저장했어요.');
}
function confirmDialog(title,message,name,key) {
  openDialog(title,`<p>${escape(message)}</p><div class="actions">${action(name,'확인',key,'primary')}${action('close-dialog','취소')}</div>`);
}
async function removeItem(type,key) {
  const next={...data};
  const options={};
  if (type==='policy') {
    const children=new Set(data.confirmed_coverages.filter(row=>row.policy_id===key).map(row=>row.id));
    next.policies=data.policies.filter(p=>p.id!==key);
    next.confirmed_coverages=data.confirmed_coverages.filter(r=>r.policy_id!==key);
    next.documents=data.documents.map(d=>({...d,related_policy_ids:asArray(d.related_policy_ids).filter(p=>p!==key)}));
    next.terms_only_catalog=data.terms_only_catalog.filter(c=>c.policy_id!==key);
    next.open_items=data.open_items.map(r=>({...r,policy_ids:asArray(r.policy_ids).filter(p=>p!==key)})).filter(r=>r.policy_ids.length);
    next.overlap_review=data.overlap_review.map(r=>({...r,coverage_ids:clearKeys(asArray(r.coverage_ids),children)})).filter(r=>r.coverage_ids.length>1);
  } else if (type==='coverage') {
    next.confirmed_coverages=data.confirmed_coverages.filter(r=>r.id!==key);
    next.overlap_review=data.overlap_review.map(r=>({...r,coverage_ids:asArray(r.coverage_ids).filter(c=>c!==key)})).filter(r=>r.coverage_ids.length>1);
  } else if (type==='claim') next.claims=data.claims.filter(r=>r.id!==key);
  else if (type==='document') {
    const remove=new Set([key,...data.documents.filter(d=>d.duplicate_of===key).map(d=>d.id)]);
    next.documents=clearKeys(data.documents,remove);
    options.remove=[...remove];
    docMatches=docMatches.filter(r=>!remove.has(r.id));
  }
  await save(next,options);
  modal.close();
  render();
  notify('삭제했어요.');
}

let pdfModule;
const pdfAPI=()=>pdfModule ||= import('./pdf.mjs');
let pdfReplaceId='';
let restoreFile=null;
function withProgress(message,task) {
  if (busy) return Promise.reject(new Error('진행 중인 작업이 끝날 때까지 기다려 주세요.'));
  busy=true;
  main.setAttribute('aria-busy','true');
  if (message) notify(message);
  return Promise.resolve().then(task).finally(()=>{busy=false;main.removeAttribute('aria-busy');});
}
async function parsePdfFile(file) {
  const api=await pdfAPI();
  let document;
  try {document=await api.loadPdf(file);}
  catch(error) {
    if (error.name!=='PasswordException') throw error;
    const password=window.prompt('PDF 비밀번호를 입력해 주세요. 비밀번호는 저장하지 않아요.');
    if (!password) throw new Error('비밀번호가 없어 등록하지 못했어요.');
    document=await api.loadPdf(file,password);
  }
  try {
    return {pdf_pages:document.numPages,pages:await api.indexPdf(document)};
  } finally {await document.destroy();}
}
async function addFiles(files,replaceId) {
  let added=0, reused=0, scan=0;
  const issues=[];
  for (const file of files) {
    try {
      const sum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
      const same=data.documents.find(d=>d.sha256===sum&&!d.duplicate_of);
      const current=docBy(replaceId)||same;
      if (same?.has_pdf && !replaceId) {reused++;continue;}
      const parsed=await parsePdfFile(file);
      const key=current?.id||id();
      const doc={...current,id:key,file_name:file.name,title:current?.title||file.name.replace(/\.pdf$/i,''),kind:current?.kind||'기타 PDF',
        related_policy_ids:asArray(current?.related_policy_ids),sha256:sum,pdf_pages:parsed.pdf_pages,text_pages:parsed.pages.filter(Boolean).length,has_pdf:true};
      await save({...data,documents:replaceRow(data.documents,doc)},{put:[[key,{blob:file,pages:parsed.pages}]]});
      added++;
      if (!doc.text_pages) scan++;
    } catch (error) {issues.push(`${file.name} · ${errorText(error)}`);}
  }
  if (issues.length) openDialog('PDF 등록 결과',`<p>${added}개 저장 · ${reused}개 중복</p>${list(issues)}`);
  notify(`PDF ${added}개 저장 · 중복 ${reused}개${scan?` · 텍스트 없는 PDF ${scan}개`:''}`);
  go('documents');
}
async function searchDocs(query) {
  docQuery=query;
  docMatches=[];
  const needle=normalize(query);
  if (!needle) {render();return;}
  for (const doc of data.documents) {
    if (doc.duplicate_of && docBy(doc.duplicate_of)) continue;
    const value=await readStore(db,'pdfs',doc.id);
    let matched=0;
    for (const [i,pageText] of (value?.pages||[]).entries()) {
      if (!normalize(pageText).includes(needle)) continue;
      const flat=pageText.replace(/\s+/g,' ');
      let index=flat.toLowerCase().indexOf(query.toLowerCase());
      if (index<0) {
        const letters=[...flat.matchAll(/[\p{L}\p{N}]/gu)];
        const normalized=letters.map(m=>normalize(m[0])).join('');
        const offset=normalized.indexOf(needle);
        if (offset>=0) index=letters[offset]?.index??0;
      }
      const start=Math.max(0,index-55);
      docMatches.push({id:doc.id,title:doc.title||doc.file_name,page:i+1,snippet:(start?'…':'')+flat.slice(start,start+175)+(flat.length>start+175?'…':'')});
      matched++;
    }
    if (!matched && normalize(`${doc.title} ${doc.file_name}`).includes(needle)) docMatches.push({id:doc.id,title:doc.title||doc.file_name,snippet:doc.file_name});
  }
  render();
}
async function viewPdf(pointer) {
  const [key,initialPage]=pointer.split('/');
  const entry=docBy(key);
  const doc=entry?.duplicate_of&&docBy(entry.duplicate_of)||entry;
  if (!doc) {notify('이 PDF를 자료실에 등록해 주세요.');return;}
  const value=await readStore(db,'pdfs',doc.id);
  if (!value?.blob) {
    openDialog(doc.title||doc.file_name,`<p>현재 브라우저에 PDF 원본이 없어요. 원본을 등록하면 이 자료의 쪽수를 바로 열 수 있어요.</p>
      <p class="muted">${escape(doc.file_name)} · PDF ${escape(initialPage||1)}쪽</p>${action('replace-pdf','이 자료의 PDF 선택',doc.id,'primary')}`);
    return;
  }
  const old=pdfState;
  pdfState=null;
  if (old?.document) await old.document.destroy();
  openDialog(doc.title||doc.file_name,`<div class="row"><div class="actions">${action('pdf-prev','이전')}
  <label>쪽 번호<input id="pdf-page" aria-label="PDF 쪽 번호" type="number" min="1" value="${Number(initialPage)||1}"></label>${action('pdf-next','다음')}</div>
  ${action('download-pdf','원본 PDF 다운로드',doc.id)}</div>
  <p id="pdf-status" class="muted" aria-live="polite">PDF를 여는 중이에요.</p><canvas id="pdf-canvas" aria-label="PDF 문서 페이지"></canvas>`);
  try {
    const api=await pdfAPI();
    let document;
    try {document=await api.loadPdf(value.blob);}
    catch(error) {
      if (error.name!=='PasswordException') throw error;
      const password=window.prompt('PDF 비밀번호를 입력해 주세요.');
      if (!password) throw new Error('PDF 비밀번호가 필요해요.');
      document=await api.loadPdf(value.blob,password);
    }
    if (!modal.open||!$('#pdf-canvas')) {await document.destroy();return;}
    pdfState={document,current:0,number:Number(initialPage)||1,docId:doc.id};
    $('#pdf-page').max=document.numPages;
    await drawPage(pdfState.number);
  } catch (error) {const target=$('#pdf-status');if (target) target.textContent=errorText(error);}
}
async function drawPage(desired) {
  const state=pdfState;
  const target=$('#pdf-page'), display=$('#pdf-status'), canvas=$('#pdf-canvas');
  if (!state||!canvas) return;
  const number=Math.min(Math.max(Math.trunc(desired)||1,1),state.document.numPages);
  state.number=number;
  const turn=++state.current;
  if (state.renderTask) {
    state.renderTask.cancel();
    await state.renderTask.promise.catch(()=>{});
  }
  target.value=number;
  display.textContent=`PDF ${number}쪽을 그리는 중이에요.`;
  const page=await state.document.getPage(number);
  if (state!==pdfState||turn!==state.current) return;
  const natural=page.getViewport({scale:1});
  const viewport=page.getViewport({scale:Math.min(2.4,1200/natural.width)});
  canvas.width=Math.ceil(viewport.width);
  canvas.height=Math.ceil(viewport.height);
  state.renderTask=page.render({canvas,canvasContext:canvas.getContext('2d'),viewport});
  try {
    await state.renderTask.promise;
    if (state===pdfState && turn===state.current) display.textContent=`PDF ${number} / ${state.document.numPages}쪽`;
  } catch(error) {if (error.name!=='RenderingCancelledException') throw error;}
}
async function restore() {
  if (!restoreFile) return;
  const file=restoreFile;
  const {data:incoming,put,replacePdfs}=await decodeBackup(file);
  const remove=[];
  if (!replacePdfs) {
    for (const existing of data.documents) {
      const replacement=incoming.documents.find(d=>d.id===existing.id && (existing.sha256&&existing.sha256===d.sha256||!existing.sha256&&!d.sha256&&existing.file_name===d.file_name));
      if (!replacement) remove.push(existing.id);
    }
    for (const doc of incoming.documents) {
      doc.has_pdf=!remove.includes(doc.id)&&!!(await readStore(db,'pdfs',doc.id))?.blob;
    }
  }
  await save(incoming,{put,remove,clear:replacePdfs});
  restoreFile=null;
  home={};group='all';filter={};docQuery='';docMatches=[];claimFilters={};
  if (modal.open) modal.close();
  go('home');
  notify(`보험 ${incoming.policies.length}건을 가져왔어요${put.length?` · PDF ${put.length}개`:''}.`);
}

document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-action]');
  if (!button||!ready) return;
  const {action:command,id:key}=button.dataset;
  via(async()=>{
    switch(command) {
      case 'example': home={query:examples[Number(key)]}; group='all'; render(); $('#search-results')?.scrollIntoView({block:'nearest'}); break;
      case 'result-group': group=key; updateResults(); break;
      case 'close-dialog': modal.close(); break;
      case 'edit-policy': editPolicy(key); break;
      case 'policy-detail': policyDetail(key); break;
      case 'edit-coverage': editCoverage(key,filter.policy||''); break;
      case 'add-linked-coverage': editCoverage('',key); break;
      case 'edit-document': editDoc(key); break;
      case 'edit-claim': editClaim(key); break;
      case 'delete-policy': confirmDialog('보험을 삭제할까요?','이 보험의 담보도 삭제돼요. PDF 원본과 기존 청구 기록은 유지됩니다.','confirm-delete-policy',key); break;
      case 'delete-coverage': confirmDialog('담보를 삭제할까요?','이 담보가 검색 결과와 보장 내역에서 사라져요.','confirm-delete-coverage',key); break;
      case 'delete-document': confirmDialog('자료를 삭제할까요?','등록된 PDF 원본과 본문 검색 자료가 삭제돼요.','confirm-delete-document',key); break;
      case 'delete-claim': confirmDialog('청구 기록을 삭제할까요?','선택한 기록이 수령액 통계에서 빠져요.','confirm-delete-claim',key); break;
      case 'confirm-delete-policy':
      case 'confirm-delete-coverage':
      case 'confirm-delete-document':
      case 'confirm-delete-claim': await withProgress('',()=>removeItem(command.slice(15),key)); break;
      case 'add-pdfs': pdfReplaceId=''; $('#pdf-input').multiple=true; $('#pdf-input').click(); break;
      case 'replace-pdf': pdfReplaceId=key; $('#pdf-input').multiple=false; $('#pdf-input').click(); break;
      case 'view-source': await viewPdf(key); break;
      case 'pdf-prev': await drawPage(pdfState?.number-1); break;
      case 'pdf-next': await drawPage(pdfState?.number+1); break;
      case 'download-pdf': {
        const value=await readStore(db,'pdfs',key);
        if (value?.blob) download(value.blob,docBy(key)?.file_name||'document.pdf');
        break;
      }
      case 'restore': $('#backup-input').click(); break;
      case 'confirm-restore': await withProgress('자료를 가져오는 중이에요.',restore); break;
      case 'backup-json': {
        const metadata={...data,documents:data.documents.map(d=>({...d,has_pdf:false}))};
        download(JSON.stringify(metadata,null,2),`yunas-insurance-${now()}.json`,'application/json'); break;
      }
      case 'backup-zip': await withProgress('PDF 포함 백업을 만드는 중이에요.',async()=>{
        download(await encodeBackup(db,data),`yunas-insurance-${now()}.zip`);notify('백업 파일을 만들었어요.');
      }); break;
      case 'persist': {
        const allowed=await navigator.storage?.persist?.();
        notify(allowed?'브라우저가 저장 공간 보존 요청을 승인했어요.':'이 브라우저에서 저장 공간 보존을 승인하지 않았어요.'); break;
      }
      case 'reset': confirmDialog('전체 데이터를 초기화할까요?','브라우저의 보험, PDF, 청구 기록이 모두 삭제돼요. 백업 파일이 있어야 복원할 수 있어요.','confirm-reset'); break;
      case 'confirm-reset': await withProgress('',async()=>{
        await save(emptyData(),{clear:true}); home={};group='all';filter={};docQuery='';docMatches=[];claimFilters={};modal.close();render();notify('초기화했어요.');
      }); break;
    }
  });
});
document.addEventListener('submit',event=>{
  const form=event.target;
  if (!form.id || !ready) return;
  event.preventDefault();
  via(async()=>{
    if (form.id==='search-form') {home=fieldValues(form);group='all';updateResults();}
    else if (form.id==='coverage-form') {filter=fieldValues(form);render();}
    else if (form.id==='documents-form') await withProgress('',()=>searchDocs(fieldValues(form).query));
    else if (form.id.startsWith('edit-')) await withProgress('',()=>submitEdit(form));
  });
});
document.addEventListener('change',event=>{
  const input=event.target;
  if (!ready) return;
  if (input.id==='pdf-input') {
    const files=[...input.files];
    const replace=pdfReplaceId;
    input.value='';
    if (!files.length) return;
    if (replace && docBy(replace)?.has_pdf && !window.confirm('등록된 PDF 원본을 교체할까요? 새 문서가 다른 판본이면 기존 근거의 쪽수를 다시 확인해 주세요.')) return;
    via(()=>withProgress('PDF 본문을 읽어 저장하고 있어요.',()=>addFiles(files,replace)));
  } else if (input.id==='backup-input') {
    const file=input.files[0];
    input.value='';
    if (!file) return;
    restoreFile=file;
    if (data.policies.length||data.claims.length||data.documents.length) confirmDialog('현재 데이터를 바꿀까요?', '보험·청구 기록은 선택한 파일의 내용으로 교체됩니다. PDF를 함께 바꾸려면 ZIP을 선택해 주세요.','confirm-restore');
    else via(()=>withProgress('자료를 가져오는 중이에요.',restore));
  } else if (input.id==='pdf-page') via(()=>drawPage(Number(input.value)));
  else if (input.form?.id==='claims-filter') {claimFilters=fieldValues(input.form);render();}
  else if (input.form?.id==='edit-claim-form' && input.name==='insurer') $('#claim-riders').innerHTML=opts(data.confirmed_coverages.filter(r=>!input.value||policyBy(r.policy_id)?.insurer===input.value).map(r=>r.name));
});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();initialInstall=event;$('#install').hidden=false;});
$('#install').addEventListener('click',async()=>{if (initialInstall){await initialInstall.prompt();initialInstall=null;$('#install').hidden=true;}});
window.addEventListener('hashchange',route);
try {
  db=await openStore();
  const saved=await readStore(db,'state','data');
  if (saved) data=saved;
  ready=true;
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
} catch(error) {main.replaceChildren(document.createTextNode(errorText(error)));}
