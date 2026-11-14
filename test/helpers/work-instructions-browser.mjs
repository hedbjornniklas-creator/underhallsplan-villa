import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

export async function testWorkInstructions(base, output) {
  output=resolve(output);await mkdir(output,{recursive:true})
  const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
  let page
  try{
    page=await browser.newPage();const errors=[],requests=[]
    page.on('pageerror',error=>errors.push(error.message))
    page.on('dialog',dialog=>void dialog.accept())
    await page.setRequestInterception(true)
    page.on('request',request=>{
      const url=new URL(request.url())
      if(!['127.0.0.1','localhost'].includes(url.hostname)&&!['data:','blob:'].includes(url.protocol)){errors.push(`External request ${url.origin}`);void request.abort()}
      else{if(request.method()==='POST'&&!url.pathname.startsWith('/test/'))requests.push(url.pathname);void request.continue()}
    })
    const click=async(text,selector='button')=>{
      for(const node of await page.$$(selector))if(await node.evaluate((node,text)=>node.textContent.trim()===text,text)){await node.click();return}
      throw Error(`Missing ${text}`)
    }
    const aria=async name=>{const node=await page.$(`[aria-label=${JSON.stringify(name)}]`);assert.ok(node,name);await node.click()}
    const fill=async value=>{
      await page.$eval('.work-instruction-label textarea',(input,value)=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))},value)
    }
    const saved=()=>page.waitForFunction(()=>document.querySelector('.work-instruction-save')?.textContent==='Sparat'&&document.querySelector('[data-testid=instruction-dirty]')?.textContent==='false')
    const control=data=>fetch(`${base}/test/control`,{method:'POST',body:JSON.stringify(data)})
    const metrics=async()=>await(await fetch(`${base}/test/metrics`)).json()
    const protectedState=()=>page.$eval('[data-testid=protected-state]',node=>node.textContent)
    const noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('[role=dialog]')].every(node=>node.scrollWidth<=node.clientWidth+1)))
    await page.setViewport({width:1440,height:1000})
    await page.goto(base,{waitUntil:'networkidle0'})
    const before=await protectedState()
    assert.equal(await page.$eval('textarea',node=>node.matches(':disabled')),true)
    await click('Instruktioner','[role=tab]')
    await page.waitForSelector('.work-instruction-label textarea')
    await fill('Fiktiv instruktion för golvläggning.\nAnvänd bifogad monteringsanvisning och läggningsritning.')
    await click('Från projektet');await aria('Bifoga Monteringsanvisning-golv.pdf')
    await aria('Stäng filväljaren');await click('Från bildbanken')
    await page.waitForSelector('[aria-label="Bifoga Detaljbild.png"]')
    await aria('Granska Detaljbild.png')
    await page.waitForSelector('[role=dialog][aria-label="Granska bild"] img')
    await page.waitForFunction(()=>document.querySelector('[role=dialog][aria-label="Granska bild"] img')?.naturalWidth>0)
    await aria('Stäng bild');await aria('Bifoga Detaljbild.png');await aria('Stäng filväljaren')
    await saved()
    assert.equal(await page.$$eval('.work-instruction-files>li',nodes=>nodes.length),2)
    assert.equal(await page.$$eval('.work-instruction-files input[type=checkbox]',nodes=>nodes.length),0)
    await page.waitForFunction(()=>document.querySelector('.work-instruction-thumb img')?.naturalWidth>0)
    const bounds=await page.$eval('.work-instruction-thumb',node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}))
    assert.deepEqual(bounds,{width:44,height:44})
    await noOverflow()
    await page.screenshot({path:resolve(output,'instructions-desktop.png'),fullPage:true})
    await aria('Ta bort Monteringsanvisning-golv.pdf från instruktionerna');await saved()
    await page.click('.work-instruction-history>summary');await page.waitForSelector('.work-instruction-version')
    assert.ok((await page.$eval('.work-instruction-history',node=>node.textContent)).includes('Monteringsanvisning-golv.pdf'))
    await fill('Fiktiv instruktion med omedelbart stängningsprov.')
    await click('Stäng åtgärd');await page.waitForFunction(()=>!document.querySelector('[aria-labelledby=action-item-title]'))
    await click('Öppna moment');await click('Instruktioner','[role=tab]');await page.waitForSelector('.work-instruction-label textarea')
    assert.equal(await page.$eval('.work-instruction-label textarea',node=>node.value),'Fiktiv instruktion med omedelbart stängningsprov.')
    await control({loseAfter:true});await fill('Fiktiv instruktion med förlorat sparsvar.')
    await page.waitForSelector('.work-instruction-error')
    const committed=await metrics()
    await page.goto(`${base}/?instructions=1`,{waitUntil:'networkidle0'})
    await page.waitForSelector('.work-instruction-label textarea');await saved()
    assert.equal(await page.$eval('.work-instruction-label textarea',node=>node.value),'Fiktiv instruktion med förlorat sparsvar.')
    assert.equal((await metrics()).versions,committed.versions)
    await control({failBefore:true});await fill('Första texten i ett osparat återförsök.')
    await page.waitForSelector('.work-instruction-error')
    await fill('Nyare text som skrivs medan sparningen väntar på återförsök.')
    await control({});await click('Försök igen','.work-instruction-error button');await saved()
    assert.equal(await page.$eval('.work-instruction-label textarea',node=>node.value),'Nyare text som skrivs medan sparningen väntar på återförsök.')
    await control({conflict:true});await fill('Lokalt utkast som inte får skriva över en annan flik.')
    await page.waitForSelector('.work-instruction-error')
    assert.equal(await page.$eval('.work-instruction-label textarea',node=>node.value),'Lokalt utkast som inte får skriva över en annan flik.')
    await click('Hämta sparat');await saved()
    assert.equal(await page.$eval('.work-instruction-label textarea',node=>node.value),'Ändrad i annan flik.')
    await control({loseComplete:true})
    const path=resolve(output,'Fiktiv-monteringsanvisning.pdf');await writeFile(path,Buffer.from('%PDF-1.4\nFiktivt testunderlag. Ingen verklig handling.\n%%EOF'))
    await(await page.$('.work-instructions input[type=file]')).uploadFile(path)
    await page.waitForFunction(()=>document.querySelector('.work-instruction-uploads')?.textContent.includes('Registreringens svar försvann'))
    assert.equal((await metrics()).registered,1)
    await click('Försök igen','.work-instruction-uploads button');await page.waitForFunction(()=>!document.querySelector('.work-instruction-uploads'))
    await saved();assert.equal((await metrics()).registered,1);assert.equal((await metrics()).prepares,1)
    assert.ok((await page.$eval('.work-instruction-files',node=>node.textContent)).includes('Fiktiv-monteringsanvisning.pdf'))
    await fill('Fiktiv instruktion för golvläggning.\nSe monteringsanvisningen och detaljbilden.')
    await click('Från bildbanken');await page.waitForSelector('[aria-label="Bifoga Detaljbild.png"]');await aria('Bifoga Detaljbild.png');await aria('Stäng filväljaren');await saved()
    await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true})
    await noOverflow();await page.screenshot({path:resolve(output,'instructions-mobile.png'),fullPage:true})
    await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.work-instruction-label textarea');await saved()
    assert.ok((await page.$eval('.work-instruction-files',node=>node.textContent)).includes('Fiktiv-monteringsanvisning.pdf'))
    assert.equal(await protectedState(),before)
    await control({readOnly:true});await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.work-instruction-label textarea')
    assert.equal(await page.$eval('.work-instruction-label textarea',node=>node.readOnly),true)
    assert.deepEqual(errors,[])
    assert.ok(requests.every(path=>path.endsWith('/instructions')))
    console.log('Instructions UI passed: locked work, text + project files + diary images, existing viewer, no attached-file checkboxes, autosave + immediate close, exact lost-response retry after reload, stale-tab protection, upload registration retry without duplicates, history, mobile layout and unchanged business fields.')
  }catch(error){if(page)await page.screenshot({path:resolve(output,'instructions-failure.png'),fullPage:true}).catch(()=>{});throw error}
  finally{await browser.close()}
}
