export const examples = [
  '이비인후과에서 청력검사를 받았어', '계단에서 넘어져서 발목을 다쳤어', '정형외과에서 물리치료를 받았어',
  '건강검진 중 용종을 제거했어', '치과에서 충치 치료를 받았어', '손가락 골절 진단을 받았어',
  '독감으로 수액을 맞았어', '교통사고로 병원에 입원했어'
];

export const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const safeArray = value => Array.isArray(value) ? value : [];
const medical = /진료|검사|치료|병원|의원|처방|수액|주사|수술|외래|통원|입원|제거|절제|충치|독감|다쳤|골절|부러/;
const aliases = {
  fracture: /골절|뼈가?부러|손가락이?부러|금이가|골절상/,
  accident: /상해|재해|넘어|미끄러|낙상|다쳤|접질|삐었|부딪|사고|충돌/,
  traffic: /교통사고|자동차사고|차사고|차에치|추돌|접촉사고|버스사고/,
  hearing: /청력|난청|이비인후|귀먹먹|메니에르|이명/,
  dental: /치과|충치|치아|임플란트|크라운|잇몸/,
  polyp: /용종|폴립/,
  gyn: /산부인과|부인과|자궁|난소|골반염|폐경|자궁근종|자궁내막증/,
  cancer: /암진단|암수술|유방암|갑상선암|자궁암|난소암|대장암|폐암|위암|췌장암|제자리암|상피내암|악성종양|경계성종양|암으로|암이래/,
  stroke: /뇌졸중|뇌출혈|뇌경색|뇌혈관/,
  heart: /심근경색|관상동맥|협심증/,
  commonIllness: /독감|인플루엔자|감기|질병|청력|난청|이명|충치|용종|폴립|장염|관절염|요통|디스크|당뇨|고혈압/,
  disability: /후유장해|장해율|장해진단|장애판정/,
  property: /화재|가전|누수|붕괴|침강|일상생활배상|배상책임|보복운전|형사합의|변호사선임|자동차벌금|스쿨존/
};

export function matchesCode(code, entry) {
  const codeValue = String(code).toUpperCase().replace(/[^A-Z0-9.]/g, '');
  const [first, last] = String(entry).toUpperCase().replace(/\s/g, '').split(/[-~–]/);
  if (!codeValue || !first) return false;
  if (!last) return codeValue === first || codeValue.startsWith(first) || codeValue.slice(0, 3) === first.slice(0, 3) && codeValue.length === 3;
  if (first.includes('.') || last.includes('.')) return codeValue >= first && codeValue <= last;
  return codeValue.slice(0, 3) >= first && codeValue.slice(0, 3) <= last;
}

const status = { possible:'지급 조건 충족 가능', pending:'추가 확인 필요', excluded:'보장 제외 확인' };
export function searchCoverage(data, input = {}) {
  const query = normalize(input.query);
  const cause = input.cause || '';
  const type = input.type || '';
  const code = (String(input.code || '').toUpperCase().match(/[A-Z]\d{2}(?:\.?\d{1,4})?/) ?? String(input.query || '').toUpperCase().match(/\b[A-Z]\d{2}(?:\.\d{1,4})?\b/))?.[0];
  const tags = Object.fromEntries(Object.entries(aliases).map(([k,r])=>[k,r.test(query)]));
  const symptoms = tags.hearing || tags.dental || tags.polyp || tags.gyn || tags.cancer || tags.stroke || tags.heart || tags.commonIllness;
  const noFracture = /골절없|골절이없|골절아니|골절은아니|골절안|골절은없/.test(query);
  const fractureCode = code && /^(S02|S07|S09\.9|S12|S22|S32|S42|S52|S62|S72|S82|S92|T02|T08|T10|T12|T14\.2)/.test(code);
  const nonAdmission = /입원안|입원은안|입원없이|입원하지않/.test(query);
  const admission = type === '입원' || !nonAdmission && /입원|입실/.test(query);
  const outpatient = type === '통원' || type === '검사' || type === '치료' || /외래|통원|의원|수액|충치|청력검사|물리치료|진료|병원|치과/.test(query);
  const surgery = type === '수술' || /수술|절제|제거|용종뗐|폴립뗐|인공관절/.test(query);
  const simpleCheck = /검진|건강검사/.test(query) && !surgery && !/치료목적|증상/.test(query);
  const inferredInjury = tags.accident || fractureCode || tags.fracture && !noFracture;
  const injury = cause ? cause === '상해' : inferredInjury;
  const illness = cause ? cause === '질병' : !inferredInjury && symptoms;
  const dentalNonCovered = tags.dental && /비급여/.test(query) && !/급여도|급여와|급여비급여/.test(query);
  const motorcycle = /오토바이|이륜차|이륜자동차/.test(query) && /탑승|운전|타다|타고|타던/.test(query);
  const isMedical = medical.test(query) || !!type;
  const results = [];

  for (const row of data.confirmed_coverages) {
    const policy = data.policies.find(p => p.id === row.policy_id);
    if (!policy || !['정상','유지(정상)'].includes(policy.status) || ['관리','부담보'].includes(row.reimbursement_kind)) continue;
    const rowTypes = safeArray(row.benefit_types);
    const rowCodes = safeArray(row.kcd_codes);
    const isReal = row.reimbursement_kind === '실손의료';
    const codeMatched = code && rowCodes.some(item=>matchesCode(code,item));
    const rowName = normalize(row.name);
    const textMatch = query.length >= 3 && (rowName.length >= 3 && query.includes(rowName) || rowName.includes(query));
    const scopeMatch = (input.part && (safeArray(row.body_parts).some(v=>normalize(v).includes(normalize(input.part))))) ||
      (input.department && safeArray(row.related_departments).some(v=>normalize(v).includes(normalize(input.department))));
    const causeOK = !cause || !row.cause || cause === '상해' && /상해|재해|교통/.test(row.cause) || cause === '질병' && /질병/.test(row.cause);
    const sameType = !type || rowTypes.includes(type) || (tags.traffic && rowTypes.includes('부상등급'));
    let score=0, verdict=status.pending, detail='', questions=[];
    if (causeOK && sameType && (codeMatched || textMatch || (!query && (type || cause) && (scopeMatch || !input.part && !input.department)))) score=codeMatched?65:textMatch?55:22;
    if (causeOK && scopeMatch && (query.length===0 || sameType && type)) score=Math.max(score,25);

    const isFracture = ['HW07-fracture','M04-fracture','ML20-fracture'].includes(row.id);
    if (isFracture && !noFracture && (tags.fracture || fractureCode || tags.accident && !tags.traffic && /발목|손목|손가락|발가락|발|팔|다리|쇄골|갈비/.test(query)) && causeOK) {
      score=Math.max(score,tags.fracture||fractureCode?95:47);
      detail='골절 진단과 사고 경위를 확인해요. 정액 담보는 각 보험의 조건을 충족하면 건별로 검토할 수 있어요.';
      questions=['진단서에 적힌 골절 코드와 사고일은 무엇인가요?','같은 사고로 이미 지급된 골절 진단비가 있나요?'];
      if (row.id==='HW07-fracture') questions.push('골절을 직접 치료하는 수술을 받았나요?');
      if (/^S02\.?5$/.test(code||'') && row.id!=='HW07-fracture') {
        verdict=status.excluded;
        detail='치아 파절 S02.5는 이 담보에서 제외됩니다.';
      } else if (input.date && !!codeMatched && cause==='상해' && code.length>=3 && type==='진단' && !motorcycle) verdict=status.possible;
    }
    if (row.id==='SL13-medical-outpatient' && (!admission || outpatient) && (illness || symptoms && !cause || (outpatient && !cause && !inferredInjury) || !query && ['통원','검사','치료'].includes(type) && causeOK || simpleCheck && causeOK)) {
      score=Math.max(score,illness?100:76);
      detail='질병의 진단·치료 목적과 외래 영수증의 인정 금액을 확인해요.';
      questions=['외래 진료였나요? 진단명과 진료·처치 목적은 무엇인가요?','병원 종류와 급여·비급여가 구분된 진료비는 얼마인가요?'];
      if (tags.hearing) questions.unshift('증상이나 진단을 확인하기 위한 청력검사였나요?');
      if (tags.polyp) questions.unshift('검진료와 용종 제거 비용이 따로 기재됐나요?');
      if (tags.dental) questions.unshift('충치 치료에서 건강보험 급여 본인부담금과 비급여는 각각 얼마인가요?');
      if (/독감|수액|영양제|비타민/.test(query)) questions.unshift('수액 성분과 처방 목적을 확인할 수 있나요?');
      if (dentalNonCovered || simpleCheck) {
        verdict=status.excluded;
        detail=dentalNonCovered?'치과 비급여 비용은 이 질병통원형의 제외 조항에 해당합니다.':'단순 건강검진 비용은 이 질병통원형의 제외 조항에 해당합니다.';
      } else if (input.date && cause==='질병' && type==='통원' && !tags.dental && !tags.polyp && !/수액|주사|검진/.test(query)) verdict=status.possible;
    }
    if (row.id==='SL13-medical-inpatient' && admission) {
      score=Math.max(score,100);
      detail='실제 입원 치료와 대상 의료비를 확인해요. 자동차보험 등에서 이미 보상된 의료비와 비례 분담도 확인이 필요해요.';
      questions=['입퇴원일과 진단명은 무엇인가요?','다른 보험에서 동일한 입원 의료비를 보상받았나요?'];
    }
    if (row.id==='HW07-injury-medical' && causeOK && (injury && (!tags.property || isMedical) || !cause && /물리치료/.test(query) || !query && type && cause==='상해' && sameType)) {
      score=Math.max(score,injury?88:61);
      detail='사고로 다쳐 치료받고 실제 부담한 비용을 확인해요.';
      questions=['사고일과 초진일은 언제인가요?','사고와 진료 사이의 관련성이 확인되나요?','동일 의료비를 보상하는 다른 보험이 있나요?'];
    }
    if (row.id==='HW07-injury-admission' && admission && !illness) score=Math.max(score,injury?98:45);
    if (row.id==='HW07-illness-admission' && admission && !injury) score=Math.max(score,illness?98:45);
    if (row.id==='ML20-surgery' && surgery && !simpleCheck) {
      score=Math.max(score,tags.polyp?99:75);
      detail=tags.polyp?'용종 제거술이 약관상 내시경 수술에 해당하는지 확인해요. 복부장기 내시경 수술로 분류되면 2종 30만원 검토 대상이에요.':'실제 수술명·부위·방법으로 약관 수술분류를 확인해요.';
      questions=['수술·시술명과 부위가 적힌 서류가 있나요?','동일 치료로 60일 이내에 수술을 또 받았나요?'];
    }
    if (tags.traffic && rowTypes.includes('부상등급')) {
      score=Math.max(score,100);
      detail='자동차사고 부상등급에 따라 정액으로 검토해요.';
      questions=['운전·탑승·보행 중 어느 상황이었나요?','자동차보험 보상처리확인서의 부상등급은 몇 급인가요?'];
    }
    if ((tags.gyn && (admission || surgery) && ['HW07-gyn','ML20-gyn','HW07-disease16-surgery'].includes(row.id)) ||
        (tags.cancer && /암|추가보장|리빙케어|선지급/.test(row.name) && (!rowTypes.includes('수술') || surgery || rowTypes.includes('진단'))) ||
        (tags.stroke && /뇌출혈|뇌경색/.test(row.name) && !/뇌경색/.test(query.replace(/뇌출혈/g,'')) || tags.stroke && row.id==='ML20-stroke') ||
        (tags.heart && /급성심근경색/.test(row.name) && /심근경색/.test(query)) ||
        (tags.disability && /장해/.test(row.name) && !/부담보/.test(row.name))) score=Math.max(score,65);
    if (causeOK && sameType && ((surgery && /인공관절|인공골두/.test(query) && row.id==='M04-joint-surgery') ||
        (tags.property && /화재|가전|누수|붕괴|배상|벌금|형사합의|변호사|보복/.test(rowName) && [...query.matchAll(/화재|가전|누수|붕괴|배상|벌금|형사합의|변호사|보복|처리지원/g)].some(([word])=>normalize(row.name+row.payment_rule).includes(word))))) score=Math.max(score,92);
    if (noFracture && isFracture && !textMatch && !codeMatched) score=0;
    if (score===0 || (!query && !cause && !type && !code && !input.part && !input.department)) continue;
    if (query && type && !sameType && !['SL13-medical-outpatient','HW07-injury-medical'].includes(row.id)) score=0;
    if (!score) continue;
    if (motorcycle && row.policy_id==='HW07' && /상해/.test(row.cause||'')) {
      verdict=status.excluded;
      detail='한화 보험증권의 이륜자동차 운전·탑승 중 상해 부담보가 적용되는지 확인해요.';
    }
    const startDate = row.insured_period_start || policy.coverage_start;
    const endDate = /^\d{4}-/.test(row.insured_period_end || '') ? row.insured_period_end : /^\d{4}-/.test(policy.coverage_end || '') ? policy.coverage_end : null;
    if (input.date && ((startDate && input.date<startDate) || (endDate && input.date>endDate))) {
      verdict=status.pending;
      detail='등록된 담보 기간 밖의 날짜입니다. 사고일에 유효했던 증권·갱신 또는 변경 이력을 확인해요.';
    }
    if (!causeOK && verdict!==status.excluded) continue;
    if (!questions.length) questions=['진료·사고일과 진단명 또는 수술명을 확인했나요?','사고일 당시 담보의 유효기간과 약관의 지급 세부조건을 확인했나요?'];
    if (!input.date && !questions.some(x=>x.includes('사고일'))) questions.push('진료·사고일 기준으로 담보가 유효했나요?');
    results.push({row,policy,score,verdict,detail,questions});
  }
  const unresolved = data.policies.filter(p=>['상세 가입자료 필요','일부 담보 등록'].includes(p.personal_riders_status) && ['정상','유지(정상)'].includes(p.status) &&
    (p.registry_categories?.includes('단체보험') && (isMedical || tags.accident || symptoms) || p.id==='KB26' && tags.traffic || p.id==='HN15' && /저축|만기|환급/.test(query)));
  const sort = (a,b)=>b.score-a.score || a.policy.insurer.localeCompare(b.policy.insurer,'ko');
  return {results:results.sort(sort),unresolved};
}
