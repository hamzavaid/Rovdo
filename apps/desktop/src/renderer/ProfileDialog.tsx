import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
export function ProfileDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
 const ref=useRef<HTMLDialogElement>(null);const id=useId();
 useEffect(()=>{const dialog=ref.current!;const previous=document.activeElement;dialog.showModal();return()=>{dialog.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
 return createPortal(<dialog ref={ref} className="profile-dialog" aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose();}}><div className="dialog-heading"><h2 id={id}>{title}</h2><button type="button" className="dialog-close" aria-label="Close qualification editor" onClick={onClose}>&times;</button></div><div className="dialog-content">{children}</div></dialog>,document.body);
}
