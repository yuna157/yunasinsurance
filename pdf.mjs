import * as pdfjs from './vendor/pdf.min.mjs';
const resource = path => new URL(`./vendor/${path}`,import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc=resource('pdf.worker.min.mjs');
export async function loadPdf(blob,password) {
  return pdfjs.getDocument({
    data:new Uint8Array(await blob.arrayBuffer()), password, cMapUrl:resource('cmaps/'),
    cMapPacked:true, standardFontDataUrl:resource('standard_fonts/'), wasmUrl:resource('wasm/'),
    iccUrl:resource('iccs/'), isEvalSupported:false, stopAtErrors:false, enableXfa:false
  }).promise;
}
export async function indexPdf(pdf) {
  const pages=[];
  for (let i=1;i<=pdf.numPages;i++) {
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    pages.push(content.items.map(item=>item.str??'').join(' ').trim());
    page.cleanup();
  }
  return pages;
}
