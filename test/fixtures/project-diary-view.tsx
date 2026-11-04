import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ProjectDiary from '@/components/tasks/ProjectDiary'
import ProjectDiaryPublic from '@/components/tasks/ProjectDiaryPublic'
import UppdragScope from '@/components/tasks/UppdragScope'
import UppdragBrand from '@/components/tasks/UppdragBrand'

async function start() {
  if (new URLSearchParams(location.search).has('print-preview')) {
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof HTMLIFrameElement) || node.title !== 'Utskrift: Dagbokens QR-kod' || !node.contentWindow) continue
        node.contentWindow.print = () => {
          document.querySelector<HTMLDialogElement>('.diary-qr-dialog')?.close()
          node.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:99999;background:white'
          node.removeAttribute('aria-hidden')
          const close = document.createElement('button')
          close.textContent = 'Stäng testutskrift'
          close.style.cssText = 'position:fixed;right:16px;top:16px;z-index:100000;background:white;border:1px solid #aaa;padding:12px'
          close.onclick = () => { node.remove(); close.remove(); document.querySelector<HTMLDialogElement>('.diary-qr-dialog')?.showModal() }
          document.body.appendChild(close)
        }
      }
    }).observe(document.body, { childList: true })
  }
  const data = await (await fetch('/fixture')).json()
  function Preview() {
    const [active, setActive] = useState(true)
    if (location.pathname.startsWith('/dagbok/')) return <ProjectDiaryPublic token={location.pathname.split('/').at(-1)!} initial={data.public} />
    return <UppdragScope><div style={{ padding: '24px', maxWidth: 1260, margin: 'auto' }}><UppdragBrand /><p className="diary-notice">Fiktivt testprojekt · Inga riktiga mejl skickas · Testkod 123456</p><h1 style={{ fontSize: 26, margin: '24px 0' }}>{data.project.title}</h1><nav style={{ display: 'flex', gap: 8, marginBottom: 24 }}><button className="diary-button" onClick={() => setActive(false)}>Översikt</button><button className="diary-button" onClick={() => setActive(true)}>Dagbok</button><a href={data.publicUrl}>Mobilt QR-formulär</a></nav><ProjectDiary caseId={data.project.id} active={active} />{!active && <h2>Översikt · Fiktivt testprojekt</h2>}</div></UppdragScope>
  }
  createRoot(document.getElementById('root')!).render(<Preview />)
}
void start()
