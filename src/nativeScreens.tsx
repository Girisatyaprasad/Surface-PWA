import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import type { Note, Pin } from './db';
import { getSurfaceFirebase } from './firebase';
import { objectUrl, type SurfaceMedia } from './media';
import type { SurfaceLocation } from './location';
import { formatSurfaceLocation } from './location';
import { SurfaceDialog } from './SurfaceDialog';

export type NativeRoute = 'home' | 'gallery' | 'notes' | 'camera' | 'captures' | 'pins' | 'profile' | 'account' | 'surface-pro' | 'new-pin' | 'new-note' | 'search';

export function NativeHome({ routeTo, isPro }: { routeTo: (route: NativeRoute) => void; isPro: boolean }) {
  const accent = isPro ? 'is-paid' : '';
  return <>
    <div className="home-spacer" />
    <section className="destination-grid" aria-label="Surface destinations">
      <NativeDestination title="Gallery" icon="gallery" paid={accent} onClick={() => routeTo('gallery')} />
      <NativeDestination title="Notes" icon="notes" paid={accent} onClick={() => routeTo('notes')} />
      <NativeDestination title="Camera" icon="camera" paid={accent} onClick={() => routeTo('camera')} />
      <NativeDestination title="PINs" icon="pins" paid={accent} onClick={() => routeTo('pins')} />
    </section>
    <button className={isPro ? 'primary-action home-create' : 'surface-action home-create'} onClick={() => routeTo('new-note')}><span aria-hidden="true">＋</span><span>Create Note</span></button>
  </>;
}

function NativeDestination({ title, icon, paid, onClick }: { title: string; icon: string; paid: string; onClick: () => void }) {
  return <button className="destination" onClick={onClick}><img className={`destination-icon ${paid}`} src={`/icons/${icon}.svg`} alt="" /><span>{title}</span></button>;
}

export function NativePins({ pins, media, onCreate, onOpen, onDelete }: { pins: Pin[]; media: SurfaceMedia[]; onCreate: () => void; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const longPress = useRef(false);
  return <section className="native-list-screen native-pins-screen">
    <div className="section-heading"><h2>Surface PINs</h2></div>
    {pins.length === 0 ? <PinsEmpty onCreate={onCreate} /> : <div className="native-pin-list">
      {pins.map((pin) => { const image = pin.mediaIds?.map((id) => media.find((item) => item.id === id)).find(Boolean); const menuOpen = menuFor === pin.id; return <div className="native-pin-entry" key={pin.id}><button className="native-pin-row" onClick={() => { if (longPress.current) { longPress.current = false; return; } onOpen(pin.id); }} onContextMenu={(event) => { event.preventDefault(); longPress.current = true; setMenuFor(pin.id); }} onPointerDown={(event) => { longPress.current = false; const timer = window.setTimeout(() => { longPress.current = true; setMenuFor(pin.id); }, 650); const cancel = () => { clearTimeout(timer); event.currentTarget.removeEventListener('pointerup', cancel); event.currentTarget.removeEventListener('pointercancel', cancel); }; event.currentTarget.addEventListener('pointerup', cancel); event.currentTarget.addEventListener('pointercancel', cancel); }}>{image ? <img src={objectUrl(image.processed)} alt="" /> : <div className="pin-fallback">PIN</div>}<span><strong>{pin.name || 'Unnamed PIN'}</strong><small>{pin.phone || 'No phone number'}</small></span></button>{menuOpen && <div className="pins-context-menu"><button onClick={() => { setMenuFor(null); onOpen(pin.id); }}>Edit</button><button onClick={() => { setMenuFor(null); setPendingDelete(pin.id); }}>Delete</button></div>}</div>; })}
    </div>}
    {pendingDelete && <PinDeleteDialog onCancel={() => setPendingDelete(null)} onDelete={() => { const id = pendingDelete; setPendingDelete(null); onDelete(id); }} />}
  </section>;
}

function PinsEmpty({ onCreate }: { onCreate: () => void }) {
  return <div className="pins-empty"><strong>Oops!!<br />Surface PINs is empty!</strong><button onClick={onCreate}><NativePlusIcon /><span>Create PIN</span></button></div>;
}

function PinDeleteDialog({ onCancel, onDelete }: { onCancel: () => void; onDelete: () => void }) {
  return <SurfaceDialog className="surface-dialog--pin-confirm" labelledBy="pin-delete-title"><strong id="pin-delete-title">Delete this PIN? NoteBlock and captures will remain.</strong><div className="surface-dialog-actions"><button className="surface-dialog-cancel" onClick={onCancel}>Cancel</button><button className="surface-dialog-confirm" onClick={onDelete}>Confirm</button></div></SurfaceDialog>;
}

export function NativeNotes({ notes, onCreate, onOpen, onDelete }: { notes: Note[]; onCreate: () => void; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  const groups = useMemo(() => {
    const byDate = new Map<string, Note[]>();
    notes.forEach((note) => { const key = note.dateKey || new Date(note.createdAt).toLocaleDateString('en-GB'); byDate.set(key, [...(byDate.get(key) ?? []), note]); });
    return [...byDate.entries()];
  }, [notes]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  return <section className="native-list-screen native-notes-screen">
    <div className="section-heading"><h2>Surface Notes</h2><button className="notes-add" onClick={onCreate} aria-label="Create a note"><NativePlusIcon /></button></div>
    {notes.length === 0 ? <NotesEmpty onCreate={onCreate} /> : <div className="native-note-list">{groups.map(([date, dayNotes]) => <section className="note-day" key={date}><h3>{date}</h3>{groupByLocation(dayNotes).map(([location, locationNotes]) => <div className="note-location" key={`${date}-${location}`}><h4>{location}</h4>{locationNotes.map((note) => <NativeNoteRow key={note.id} note={note} onOpen={() => onOpen(note.id)} onLongPress={() => setMenuFor(note.id)} />)}</div>)}</section>)}</div>}
    {menuFor && <div className="notes-context-menu"><button onClick={() => { setMenuFor(null); setPendingDelete(menuFor); }}>Delete</button></div>}
    {pendingDelete && <NoteDeleteDialog onCancel={() => setPendingDelete(null)} onDelete={() => { const id = pendingDelete; setPendingDelete(null); onDelete(id); }} />}
  </section>;
}

function NativeNoteRow({ note, onOpen, onLongPress }: { note: Note; onOpen: () => void; onLongPress: () => void }) {
  const longPress = useRef(false);
  return <button className="native-note-row" onClick={() => { if (longPress.current) { longPress.current = false; return; } onOpen(); }} onContextMenu={(event) => { event.preventDefault(); longPress.current = true; onLongPress(); }} onPointerDown={(event) => { longPress.current = false; const timer = window.setTimeout(() => { longPress.current = true; onLongPress(); }, 650); const cancel = () => { clearTimeout(timer); event.currentTarget.removeEventListener('pointerup', cancel); event.currentTarget.removeEventListener('pointercancel', cancel); }; event.currentTarget.addEventListener('pointerup', cancel); event.currentTarget.addEventListener('pointercancel', cancel); }}><span><strong>{note.name || 'Note'}</strong>{note.phone && <small>{note.phone}</small>}{note.body && <small className="note-preview">{note.body}</small>}</span><time>{new Date(note.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></button>;
}

function NotesEmpty({ onCreate }: { onCreate: () => void }) {
  return <div className="notes-empty"><strong>Oops!!<br />Surface Notes is empty!</strong><button onClick={onCreate}><NativePlusIcon /><span>Create Note</span></button></div>;
}

function NoteDeleteDialog({ onCancel, onDelete }: { onCancel: () => void; onDelete: () => void }) {
  return <SurfaceDialog labelledBy="note-delete-title"><strong id="note-delete-title">Delete this note? Any PIN using it will also be deleted. Captures stay saved.</strong><div className="surface-dialog-actions"><button className="surface-dialog-cancel" onClick={onCancel}>Cancel</button><button className="surface-dialog-destructive" onClick={onDelete}>Delete</button></div></SurfaceDialog>;
}

function groupByLocation(notes: Note[]): [string, Note[]][] { const groups = new Map<string, Note[]>(); notes.forEach((note) => { const location = note.locationLabel || 'Location unavailable'; groups.set(location, [...(groups.get(location) ?? []), note]); }); return [...groups.entries()]; }

export function NativeCaptures({ items, pins, onCamera, onCreatePin, onConnectExisting, onDelete }: { items: SurfaceMedia[]; pins: Pin[]; onCamera: () => void; onCreatePin: (id: string) => void; onConnectExisting: (mediaId: string, pinId: string) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const longPress = useRef(false);
  const [opened, setOpened] = useState<number | null>(null);
  const [actionFor, setActionFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [connectFor, setConnectFor] = useState<string | null>(null);

  if (opened !== null && items[opened]) {
    return <NativeCapturePost item={items[opened]} items={items} index={opened} onBack={() => setOpened(null)} onCreatePin={onCreatePin} onDelete={() => { setPendingDelete(items[opened].id); setOpened(null); }} />;
  }

  return <section className="native-media-screen native-captures-screen">
    <div className="section-heading"><h2>Captures</h2></div>
    {items.length === 0 ? <CapturesEmpty onCamera={onCamera} /> : <div className="native-captures-grid">
      {items.map((item, index) => <article className="native-capture-tile" key={item.id}>
        <button
          aria-label={`Open capture from ${item.dateKey}`}
          onClick={() => { if (longPress.current) { longPress.current = false; return; } setOpened(index); }}
          onContextMenu={(event) => { event.preventDefault(); longPress.current = true; setActionFor(item.id); }}
          onPointerDown={(event) => {
            longPress.current = false;
            const timer = window.setTimeout(() => { longPress.current = true; setActionFor(item.id); }, 650);
            const cancel = () => { clearTimeout(timer); event.currentTarget.removeEventListener('pointerup', cancel); event.currentTarget.removeEventListener('pointercancel', cancel); };
            event.currentTarget.addEventListener('pointerup', cancel);
            event.currentTarget.addEventListener('pointercancel', cancel);
          }}
        ><img src={objectUrl(item.processed)} alt="" /></button>
        {actionFor === item.id && <div className="capture-tile-action">
          <button onClick={() => { setActionFor(null); onCreatePin(item.id); }}>Create PIN</button>
          <button onClick={() => { setActionFor(null); setConnectFor(item.id); }}>Connect Existing</button>
          <button className="destructive" onClick={() => { setActionFor(null); setPendingDelete(item.id); }}>Delete</button>
        </div>}
      </article>)}
    </div>}
    {pendingDelete && <CaptureDeleteDialog onCancel={() => setPendingDelete(null)} onDelete={() => { const id = pendingDelete; setPendingDelete(null); void onDelete(id); }} />}
    {connectFor && <CaptureConnectDialog mediaId={connectFor} pins={pins} onCancel={() => setConnectFor(null)} onConnect={async (pinId) => { const mediaId = connectFor; setConnectFor(null); await onConnectExisting(mediaId, pinId); }} />}
  </section>;
}

function CapturesEmpty({ onCamera }: { onCamera: () => void }) {
  return <div className="captures-empty"><strong>Oops!!<br />Surface Captures is empty!</strong><button onClick={onCamera}><NativePlusIcon /><span>Camera</span></button></div>;
}

function CaptureDeleteDialog({ onCancel, onDelete }: { onCancel: () => void; onDelete: () => void }) {
  return <SurfaceDialog labelledBy="capture-delete-title"><strong id="capture-delete-title">Delete this capture? Any PIN link to it will be removed.</strong><div className="surface-dialog-actions"><button className="surface-dialog-cancel" onClick={onCancel}>Cancel</button><button className="surface-dialog-destructive" onClick={onDelete}>Delete</button></div></SurfaceDialog>;
}

function CaptureConnectDialog({ mediaId, pins, onCancel, onConnect }: { mediaId: string; pins: Pin[]; onCancel: () => void; onConnect: (pinId: string) => Promise<void> }) {
  return <SurfaceDialog className="capture-connect-dialog" labelledBy="capture-connect-title"><h3 id="capture-connect-title">Connect to a PIN</h3>{pins.map((pin) => <button key={pin.id} onClick={() => void onConnect(pin.id)}>{pin.name || 'Unnamed PIN'}</button>)}<button onClick={onCancel}>Cancel</button></SurfaceDialog>;
}

function NativeCapturePost({ item, items, index, onBack, onCreatePin, onDelete }: { item: SurfaceMedia; items: SurfaceMedia[]; index: number; onBack: () => void; onCreatePin: (id: string) => void; onDelete: () => void }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const download = () => { const link = document.createElement('a'); link.href = objectUrl(item.processed); link.download = `Surface-${item.dateKey.replaceAll('/', '-')}.jpg`; link.click(); setSaveMessage('Saved to phone.'); };
  if (viewerOpen) return <NativeViewer items={[item]} index={0} mode="capture" onClose={() => setViewerOpen(false)} onChange={() => undefined} />;
  return <section className="capture-post-screen">
    <div className="capture-post-header"><div><strong>Surface Capture</strong><span>Capture gallery</span></div><button onClick={onBack}>Back</button></div>
    <button className="capture-post-image" onClick={() => setViewerOpen(true)}><img src={objectUrl(item.processed)} alt="Open capture" /></button>
    {saveMessage && <p>{saveMessage}</p>}
    <div className="capture-post-actions"><button onClick={download}>Save to phone</button><button className="capture-create-pin" onClick={() => onCreatePin(item.id)}>Create PIN</button><button className="capture-delete" onClick={onDelete}>Delete</button></div>
  </section>;
}

export function NativeMediaGrid({ title, items, pins, onImport, onDelete, onCreatePin, onConnectExisting }: { title: string; items: SurfaceMedia[]; pins: Pin[]; onImport?: (file: File) => Promise<void>; onDelete: (id: string) => Promise<void>; onCreatePin?: (id: string) => void; onConnectExisting?: (mediaId: string, pinId: string) => Promise<void> }) {
  const picker = useRef<HTMLInputElement>(null); const longPress = useRef(false); const [menuFor, setMenuFor] = useState<string | null>(null); const [pendingGalleryDelete, setPendingGalleryDelete] = useState<string | null>(null); const [connectFor, setConnectFor] = useState<string | null>(null); const [viewer, setViewer] = useState<number | null>(null);
  const captureGrid = title === 'Captures';
  const gallery = title === 'Surface Gallery';
  if (viewer !== null && items[viewer]) return <NativeViewer items={items} index={viewer} mode={gallery ? 'gallery' : 'pin'} onClose={() => setViewer(null)} onChange={setViewer} onDelete={gallery ? () => { setPendingGalleryDelete(items[viewer].id); setViewer(null); } : undefined} />;
  return <section className={`native-media-screen ${gallery ? 'native-media-screen--gallery' : ''}`}><div className="section-heading"><h2>{title}</h2>{onImport && <><input ref={picker} className="visually-hidden" type="file" accept="image/*" onChange={async (event) => { const file = event.target.files?.[0]; if (file) await onImport(file); event.target.value = ''; }} />{gallery ? <button className="gallery-upload" onClick={() => picker.current?.click()} aria-label="Upload images"><NativePlusIcon /></button> : <button className="native-round-plus" onClick={() => picker.current?.click()} aria-label="Upload images">＋</button>}</>}</div>
    {items.length === 0 ? gallery ? <GalleryEmpty onUpload={() => picker.current?.click()} /> : <NativeEmpty title="You didn't have any captures." action="Camera" onAction={() => window.location.hash = '#camera'} /> : <div className="native-media-grid">{items.map((item, index) => <article className="native-media-tile" key={item.id}><button onClick={() => { if (longPress.current) { longPress.current = false; return; } setViewer(index); }} onContextMenu={(event) => { event.preventDefault(); longPress.current = true; setMenuFor(item.id); }} onPointerDown={(event) => { longPress.current = false; const timer = window.setTimeout(() => { longPress.current = true; setMenuFor(item.id); }, 650); const cancel = () => { clearTimeout(timer); event.currentTarget.removeEventListener('pointerup', cancel); event.currentTarget.removeEventListener('pointercancel', cancel); }; event.currentTarget.addEventListener('pointerup', cancel); event.currentTarget.addEventListener('pointercancel', cancel); }}><img src={objectUrl(item.processed)} alt="" />{captureGrid && <div className="capture-stamp"><img src="/surface-logo.svg" alt="" /><span>{item.dateKey}<br />{item.timeLabel}<br />{item.locationLabel || 'Location unavailable'}</span></div>}</button>{gallery && menuFor === item.id && <div className="gallery-tile-action"><button onClick={() => { setMenuFor(null); setPendingGalleryDelete(item.id); }}>Delete</button></div>}</article>)}</div>}
    {menuFor && !gallery && <div className="overlay"><div className="native-media-menu"><button onClick={() => setMenuFor(null)}>Cancel</button>{onCreatePin && <button onClick={() => { onCreatePin(menuFor); setMenuFor(null); }}>Create PIN</button>}{onConnectExisting && <button onClick={() => { setConnectFor(menuFor); setMenuFor(null); }}>Connect Existing</button>}<button className="destructive" onClick={() => { const id = menuFor; setMenuFor(null); void onDelete(id); }}>Delete</button></div></div>}
    {pendingGalleryDelete && <GalleryDeleteDialog onCancel={() => setPendingGalleryDelete(null)} onDelete={() => { const id = pendingGalleryDelete; setPendingGalleryDelete(null); void onDelete(id); }} />}
    {connectFor && <div className="overlay"><div className="native-media-menu"><h3>Connect to a PIN</h3>{pins.map((pin) => <button key={pin.id} onClick={() => { void onConnectExisting?.(connectFor, pin.id); setConnectFor(null); }}>{pin.name || 'Unnamed PIN'}</button>)}<button onClick={() => setConnectFor(null)}>Cancel</button></div></div>}
  </section>;
}

function NativePlusIcon() {
  return <svg viewBox="0 0 960 960" aria-hidden="true"><path d="M440 440H200v80h240v240h80V520h240v-80H520V200h-80v240Z" /></svg>;
}

function GalleryEmpty({ onUpload }: { onUpload: () => void }) {
  return <div className="gallery-empty"><strong>Oops!!<br />Surface Gallery is empty!</strong><button onClick={onUpload}><NativePlusIcon /><span>Upload images</span></button></div>;
}

function GalleryDeleteDialog({ onCancel, onDelete }: { onCancel: () => void; onDelete: () => void }) {
  return <SurfaceDialog className="surface-dialog--gallery" labelledBy="gallery-delete-title"><strong id="gallery-delete-title">Delete this Gallery item?</strong><div className="surface-dialog-actions"><button className="surface-dialog-cancel" onClick={onCancel}>Cancel</button><button className="surface-dialog-gallery-confirm" onClick={onDelete}>Delete</button></div></SurfaceDialog>;
}

export function NativeViewer({ items, index, mode = 'pin', onClose, onChange, onDelete }: { items: SurfaceMedia[]; index: number; mode?: 'gallery' | 'pin' | 'capture'; onClose: () => void; onChange: (index: number) => void; onDelete?: () => void }) {
  const [activeIndex, setActiveIndex] = useState(index);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const transformRef = useRef(transform);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ type: 'drag' | 'pinch'; x: number; y: number; time: number; scale: number; offsetX: number; offsetY: number; distance?: number } | null>(null);
  const current = items[activeIndex];
  const applyTransform = (next: { scale: number; x: number; y: number }) => { transformRef.current = next; setTransform(next); };
  const constrain = (scale: number, x: number, y: number) => { const rect = stageRef.current?.getBoundingClientRect(); const limitX = rect ? (rect.width * (scale - 1)) / 2 : 0; const limitY = rect ? (rect.height * (scale - 1)) / 2 : 0; return { scale, x: Math.max(-limitX, Math.min(limitX, x)), y: Math.max(-limitY, Math.min(limitY, y)) }; };
  const reset = () => applyTransform({ scale: 1, x: 0, y: 0 });
  const change = (next: number) => { if (next < 0 || next >= items.length) return; setActiveIndex(next); onChange(next); reset(); };
  useEffect(() => { setActiveIndex(index); reset(); }, [index]);
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); if (mode === 'pin' && event.key === 'ArrowLeft') change(activeIndex - 1); if (mode === 'pin' && event.key === 'ArrowRight') change(activeIndex + 1); }; window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown); }, [activeIndex, mode, onClose]);
  if (!current) return null;
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); const points = [...pointers.current.values()]; const currentTransform = transformRef.current; if (points.length === 2) { gesture.current = { type: 'pinch', x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2, time: Date.now(), scale: currentTransform.scale, offsetX: currentTransform.x, offsetY: currentTransform.y, distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) }; } else { gesture.current = { type: 'drag', x: event.clientX, y: event.clientY, time: Date.now(), scale: currentTransform.scale, offsetX: currentTransform.x, offsetY: currentTransform.y }; } };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => { if (!pointers.current.has(event.pointerId) || !gesture.current) return; event.preventDefault(); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); const points = [...pointers.current.values()]; const start = gesture.current; if (points.length >= 2 && start.type === 'pinch' && start.distance) { const centerX = (points[0].x + points[1].x) / 2; const centerY = (points[0].y + points[1].y) / 2; const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y); const scale = Math.max(1, Math.min(5, start.scale * (distance / start.distance))); applyTransform(constrain(scale, start.offsetX + centerX - start.x, start.offsetY + centerY - start.y)); return; } if (points.length === 1 && transformRef.current.scale > 1 && start.type === 'drag') applyTransform(constrain(transformRef.current.scale, start.offsetX + event.clientX - start.x, start.offsetY + event.clientY - start.y)); };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => { const start = gesture.current; const wasPinching = pointers.current.size > 1 || start?.type === 'pinch'; pointers.current.delete(event.pointerId); if (pointers.current.size === 1) { const point = [...pointers.current.values()][0]; const currentTransform = transformRef.current; gesture.current = { type: 'drag', x: point.x, y: point.y, time: Date.now(), scale: currentTransform.scale, offsetX: currentTransform.x, offsetY: currentTransform.y }; return; } gesture.current = null; if (!start || wasPinching || transformRef.current.scale > 1 || mode !== 'gallery') return; const distance = event.clientX - start.x; if (Math.abs(distance) >= 80 && Date.now() - start.time < 700) change(distance < 0 ? activeIndex + 1 : activeIndex - 1); };
  return <div className={`native-media-viewer native-media-viewer--${mode}`} role="dialog" aria-modal="true" aria-label="Image viewer"><div ref={stageRef} className="native-viewer-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { pointers.current.clear(); gesture.current = null; }}><img src={objectUrl(current.processed)} alt="" draggable={false} style={{ transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})` }} /></div><header className="native-viewer-header"><button className="native-viewer-button" onClick={onClose}>Back</button>{mode === 'gallery' && onDelete && <button className="native-viewer-button" onClick={() => setConfirmDelete(true)}>Delete</button>}{mode === 'pin' && <div>{activeIndex > 0 && <button className="native-viewer-button" onClick={() => change(activeIndex - 1)}>Previous</button>}{activeIndex < items.length - 1 && <button className="native-viewer-button" onClick={() => change(activeIndex + 1)}>Next</button>}</div>}</header>{confirmDelete && <SurfaceDialog className="surface-dialog--gallery" labelledBy="viewer-gallery-delete-title"><strong id="viewer-gallery-delete-title">Delete this Gallery item?</strong><div className="surface-dialog-actions"><button className="surface-dialog-cancel" onClick={() => setConfirmDelete(false)}>Cancel</button><button className="surface-dialog-gallery-confirm" onClick={onDelete}>Delete</button></div></SurfaceDialog>}</div>;
}

export function NativeProfile({ uid, name, email, tier, onAccount, onPro, onHome, onEdit, onInfo }: { uid: string; name: string; email: string; tier: string; onAccount: () => void; onPro: () => void; onHome: () => void; onEdit: () => void; onInfo: (kind: 'privacy' | 'terms' | 'refunds' | 'help') => void }) {
  const [more, setMore] = useState(false);
  const [cloudName, setCloudName] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  React.useEffect(() => { let active = true; void getDoc(doc(getSurfaceFirebase().firestore, 'users', uid)).then((snapshot) => { if (!active) return; const value = snapshot.data(); setCloudName(typeof value?.displayName === 'string' ? value.displayName : null); setPhotoUri(typeof value?.photoUri === 'string' ? value.photoUri : null); }).catch(() => undefined); return () => { active = false; }; }, [uid]);
  const displayName = cloudName?.trim() || name.trim() || 'Surface User';
  const plan = tier === 'FREE' ? 'Free' : 'Surface Pro';
  const open = (item: string) => { const pages: Record<string, 'privacy' | 'terms' | 'refunds' | 'help'> = { 'Privacy Policy': 'privacy', 'Terms & Conditions': 'terms', 'Refund & Cancellation': 'refunds', Help: 'help' }; if (pages[item]) { onInfo(pages[item]); return; } const targets: Record<string, string> = { Website: 'https://adms-by-giri.web.app', Instagram: 'https://www.instagram.com/surfaceindia', Feedback: 'mailto:girisatya584@gmail.com?subject=Surface%20Feedback' }; const target = targets[item]; if (target) window.open(target, '_blank', 'noopener,noreferrer'); };
  return <section className="native-profile native-profile-screen">
    <div className="native-profile-title"><h2>Profile</h2><div><button className="profile-top-button" onClick={onHome}>Home</button><button className="profile-top-button" onClick={onEdit}>Edit</button></div></div>
    <div className="native-profile-summary"><div className="native-avatar">{photoUri ? <img className="native-avatar-photo" src={photoUri} alt="" /> : <img className="native-avatar-logo" src="/surface-logo.svg" alt="Surface" />}</div><div><strong>{displayName}</strong><small>User name</small><span className={tier === 'FREE' ? 'profile-plan profile-plan--free' : 'profile-plan'}>{plan}</span></div></div>
    <h3>Account</h3>
    <div className="native-credentials"><small>Credentials</small><strong>{email || 'Firebase account'}</strong></div>
    <NativeProfileRow title="Account" onClick={onAccount} />
    <NativeProfileRow title={more ? 'Hide more' : 'More'} onClick={() => setMore((value) => !value)} />
    {more && <div className="native-profile-more"><NativeProfileRow title="Subscriptions" onClick={onPro} />{['Website', 'Instagram', 'Privacy Policy', 'Terms & Conditions', 'Refund & Cancellation', 'Help', 'Feedback'].map((item) => <NativeProfileRow key={item} title={item} onClick={() => open(item)} />)}</div>}
  </section>;
}

function NativeProfileRow({ title, onClick }: { title: string; onClick: () => void }) { return <button className="native-profile-row" onClick={onClick}><span>{title}</span><NativeChevronIcon /></button>; }

function NativeChevronIcon() { return <svg className="profile-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>; }

type PendingCameraCapture = { file: File; capturedAt: Date; location: SurfaceLocation | null };

export function NativeCamera({ onBack, onSaved, onCreatePin, onConnectExisting, onMessage, location, pins, save }: { onBack: () => void; onSaved: (item: SurfaceMedia) => void; onCreatePin: (item: SurfaceMedia) => void; onConnectExisting: (item: SurfaceMedia, pinId: string) => Promise<void>; onMessage: (message: string) => void; location: SurfaceLocation | null; pins: Pin[]; save: (file: File, location: SurfaceLocation | null) => Promise<SurfaceMedia> }) {
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [pending, setPending] = useState<PendingCameraCapture | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const previewUrl = useMemo(() => pending ? URL.createObjectURL(pending.file) : null, [pending]);
  const label = formatSurfaceLocation(pending?.location ?? location);

  const stopCamera = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };

  useEffect(() => {
    if (pending || !navigator.mediaDevices?.getUserMedia) return () => undefined;
    let active = true;
    const startCamera = async () => {
      try {
        const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });
        if (!active) { next.getTracks().forEach((track) => track.stop()); return; }
        stream.current = next;
        if (video.current) { video.current.srcObject = next; await video.current.play(); }
      } catch {
        // The shutter still opens the native browser picker when live preview is unavailable.
      }
    };
    void startCamera();
    return () => { active = false; stopCamera(); };
  }, [facing, pending]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const beginPreview = (file: File) => setPending({ file, capturedAt: new Date(), location });
  const capture = () => {
    const camera = video.current;
    if (!camera || camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !camera.videoWidth || !camera.videoHeight) {
      input.current?.click();
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = camera.videoWidth;
    canvas.height = camera.videoHeight;
    canvas.getContext('2d')?.drawImage(camera, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) beginPreview(new File([blob], `Surface-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      else input.current?.click();
    }, 'image/jpeg', .94);
  };
  const persist = async (next: (item: SurfaceMedia) => void | Promise<void>) => {
    if (!pending || saving) return;
    setSaving(true);
    try { await next(await save(pending.file, pending.location)); }
    catch { onMessage('Photo could not be saved.'); setSaving(false); }
  };
  const discard = () => { setPending(null); setConnecting(false); setSaving(false); };

  return <section className="native-camera">
    {!pending && <video ref={video} className={`camera-live-preview ${facing === 'user' ? 'camera-live-preview--front' : ''}`} autoPlay muted playsInline aria-hidden="true" />}
    {pending && previewUrl && <img className="camera-captured-preview" src={previewUrl} alt="Captured preview" />}
    <input ref={input} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.target.files?.[0]; if (file) beginPreview(file); event.target.value = ''; }} />
    <div className="camera-top-controls">
      <button className="camera-back" onClick={() => pending ? discard() : onBack()}>Back</button>
      <button className="camera-flip" onClick={() => setFacing((value) => value === 'environment' ? 'user' : 'environment')} aria-label="Flip camera"><CameraFlipIcon /></button>
    </div>
    {label && <CameraGeotag date={pending?.capturedAt ?? new Date()} label={label} />}
    <button className="camera-shutter" onClick={capture} aria-label="Capture photo"><i /></button>
    {pending && <div className="camera-post-actions">
      <button onClick={() => void persist(onSaved)} disabled={saving}>{saving ? 'Saving' : 'Save'}</button>
      <button onClick={() => void persist(onCreatePin)} disabled={saving}>Create PIN</button>
      <button onClick={() => setConnecting(true)} disabled={saving}>Connect existing</button>
      <button onClick={discard} disabled={saving}>Discard</button>
    </div>}
    {connecting && <div className="camera-connect-sheet" role="dialog" aria-modal="true" aria-label="Connect existing PIN">
      <div><strong>Connect existing</strong>{pins.length ? pins.map((pin) => <button key={pin.id} onClick={() => void persist(async (item) => { await onConnectExisting(item, pin.id); })}>{pin.name || 'Unnamed PIN'}</button>) : <p>Create a PIN first.</p>}<button onClick={() => setConnecting(false)}>Cancel</button></div>
    </div>}
  </section>;
}

function CameraGeotag({ date, label }: { date: Date; label: string }) {
  return <div className="camera-metadata"><img src="/surface-logo.svg" alt="" /><span>{date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}<br />{date.toLocaleDateString('en-GB')}<br />{label}</span></div>;
}

function CameraFlipIcon() {
  return <svg viewBox="0 0 960 960" aria-hidden="true"><path d="M480 880q-95 0-179-42T160 720v80H80V560h240v80H204q40 75 116 117t160 43q110 0 196-67t114-173h82q-29 140-139 230t-253 90Zm-85-280q-35-35-35-85t35-85q35-35 85-35t85 35q35 35 35 85t-35 85q-35 35-85 35t-85-35ZM88 400q29-140 139-230T480 80q95 0 179 42t141 118v-80h80v240H640v-80h116q-40-75-116-117t-160-43q-110 0-196 67T170 400H88Z" /></svg>;
}

function NativeEmpty({ title, action, onAction, detail }: { title: string; action: string; onAction: () => void; detail?: string }) { return <div className="native-empty"><img src="/surface-logo.svg" alt="" /><strong>Oops!!<br />{title}</strong>{detail && <p>{detail}</p>}<button className="surface-action" onClick={onAction}>＋ {action}</button></div>; }
