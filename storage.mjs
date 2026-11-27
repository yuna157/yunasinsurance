const ID = /^[A-Za-z0-9_-]{1,100}$/;
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
export const emptyData = () => ({schema_version:2, policies:[], confirmed_coverages:[], documents:[], claims:[],
  overlap_review:[], terms_only_catalog:[], batch_history:[], open_items:[], analysis_notes:[]});

const listFields = ['policies','confirmed_coverages','documents','claims','overlap_review','terms_only_catalog','batch_history','open_items','analysis_notes'];
function validateIds(records, key) {
  const ids = new Set();
  for (const row of records) {
    if (!isRecord(row) || !ID.test(row.id || '') || ids.has(row.id)) throw new Error(`파일의 ${key} 항목 식별자를 확인해 주세요.`);
    ids.add(row.id);
  }
  return ids;
}
export function parseData(value) {
  if (!isRecord(value) || ![1,2].includes(value.schema_version) || !Array.isArray(value.policies) ||
      !Array.isArray(value.confirmed_coverages) || !Array.isArray(value.documents)) throw new Error('YUNA’S INSURANCE의 보험 데이터 JSON을 선택해 주세요.');
  const data = {...emptyData(),...value,schema_version:2};
  for (const key of listFields) if (!Array.isArray(data[key])) throw new Error(`파일의 ${key} 목록을 확인해 주세요.`);
  const policies = validateIds(data.policies,'보험');
  validateIds(data.documents,'자료');
  validateIds(data.claims,'청구 기록');
  validateIds(data.confirmed_coverages,'보장');
  for (const row of data.confirmed_coverages) {
    if (!policies.has(row.policy_id) || typeof row.name !== 'string') throw new Error('보장 내역의 연결 보험을 확인해 주세요.');
  }
  for (const row of data.policies) {
    if (typeof row.insurer !== 'string' || typeof row.product !== 'string') throw new Error('보험사와 상품명이 필요합니다.');
  }
  for (const row of data.documents) if (typeof row.file_name !== 'string' || !row.file_name) throw new Error('PDF 파일명이 필요합니다.');
  return data;
}

export function openStore() {
  return new Promise((resolve,reject)=>{
    const request = indexedDB.open('yunas-insurance-v1',1);
    request.onupgradeneeded = ()=>{
      request.result.createObjectStore('state');
      request.result.createObjectStore('pdfs');
    };
    request.onsuccess = ()=>resolve(request.result);
    request.onerror = ()=>reject(request.error);
    request.onblocked = ()=>reject(new Error('다른 앱 탭을 닫은 뒤 다시 열어 주세요.'));
  });
}

export function readStore(db,store,key) {
  return new Promise((resolve,reject)=>{
    const transaction = db.transaction(store);
    const request = transaction.objectStore(store).get(key);
    request.onsuccess = ()=>resolve(request.result);
    request.onerror = ()=>reject(request.error);
  });
}

export function saveStore(db,data,{put=[],remove=[],clear=false}={}) {
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(['state','pdfs'],'readwrite');
    const pdfs=transaction.objectStore('pdfs');
    transaction.objectStore('state').put(data,'data');
    if (clear) pdfs.clear();
    for (const id of remove) pdfs.delete(id);
    for (const [id,blob] of put) pdfs.put(blob,id);
    transaction.oncomplete=()=>resolve();
    transaction.onabort=()=>reject(transaction.error || new Error('저장이 중단됐어요.'));
    transaction.onerror=()=>reject(transaction.error || new Error('저장할 수 없어요.'));
  });
}

export function download(data,name,type) {
  const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type}));
  const link=document.createElement('a');
  link.href=url;
  link.download=name;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export async function decodeBackup(file) {
  if (!/\.zip$/i.test(file.name)) return {data:parseData(JSON.parse(await file.text())),put:[],replacePdfs:false};
  const zip=await globalThis.JSZip.loadAsync(await file.arrayBuffer());
  const manifest=zip.file('insurance_data.json');
  if (!manifest) throw new Error('ZIP 안의 insurance_data.json이 필요해요.');
  const data=parseData(JSON.parse(await manifest.async('string')));
  const put=[];
  for (const doc of data.documents) {
    const fileEntry=zip.file(`pdfs/${doc.id}.pdf`);
    const indexEntry=zip.file(`index/${doc.id}.json`);
    if (!fileEntry) continue;
    const blob=new Blob([await fileEntry.async('uint8array')],{type:'application/pdf'});
    let pages;
    if (indexEntry) {
      const index=JSON.parse(await indexEntry.async('string'));
      if (Array.isArray(index) && index.every(p=>typeof p==='string')) pages=index;
    }
    doc.has_pdf=true;
    put.push([doc.id,{blob,pages}]);
  }
  const loaded=new Set(put.map(([id])=>id));
  for (const doc of data.documents) doc.has_pdf=loaded.has(doc.id);
  return {data,put,replacePdfs:true};
}

export async function encodeBackup(db,data) {
  const zip=new globalThis.JSZip();
  zip.file('insurance_data.json',JSON.stringify(data,null,2));
  for (const doc of data.documents) {
    const value=await readStore(db,'pdfs',doc.id);
    if (!value?.blob) continue;
    zip.file(`pdfs/${doc.id}.pdf`,await value.blob.arrayBuffer());
    if (value.pages?.length) zip.file(`index/${doc.id}.json`,JSON.stringify(value.pages));
  }
  return zip.generateAsync({type:'blob',compression:'DEFLATE'});
}
