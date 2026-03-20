(function(){const c=document.createElement("link").relList;if(c&&c.supports&&c.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))d(t);new MutationObserver(t=>{for(const n of t)if(n.type==="childList")for(const l of n.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&d(l)}).observe(document,{childList:!0,subtree:!0});function r(t){const n={};return t.integrity&&(n.integrity=t.integrity),t.referrerPolicy&&(n.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?n.credentials="include":t.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function d(t){if(t.ep)return;t.ep=!0;const n=r(t);fetch(t.href,n)}})();(function(){let a;const c=document.getElementById("monaco-editor");c&&(c.innerHTML='<div class="editor-loading" style="padding: 2.5rem; color: #64748b; font-family: Inter, sans-serif; font-size: 14px;">Initializing IDE...</div>'),require.config({paths:{vs:"https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs"}}),require(["vs/editor/editor.main"],function(){c&&(c.innerHTML="",a=monaco.editor.create(c,{value:`<?php

use Native\\Laravel\\Facades\\Window;

// Window Manager Demo
// Mapping NativePHP features to browser APIs for mobile and desktop simulation.

Window::open()
    ->title('My Awesome App')
    ->width(800)
    ->height(600);
`,language:"php",theme:"vs-dark",automaticLayout:!0,fontSize:14,minimap:{enabled:!1},fontFamily:"'Fira Code', 'Monaco', monospace",padding:{top:20},scrollBeyondLastLine:!1,smoothScrolling:!0,cursorBlinking:"expand"}),console.log("Monaco Engine Loaded."))});const r=document.querySelector(".mock-canvas");d();function d(){r.innerHTML=`
            <div class="mobile-frame animate-in">
                <div class="mobile-screen">
                    <div class="mobile-status-bar">
                        <span id="mobile-clock">09:41</span>
                        <div style="display:flex; gap: 6px; align-items:center;">
                            <i data-lucide="wifi" style="width:14px; height:14px"></i>
                            <i data-lucide="signal" style="width:14px; height:14px"></i>
                            <i data-lucide="battery" style="width:18px; height:18px"></i>
                        </div>
                    </div>
                    <div class="mobile-content" id="mobile-viewport">
                        <div class="app-icon-shell">
                            <i data-lucide="zap" class="pulse-glow"></i>
                        </div>
                        <h3>Native Bridge</h3>
                        <p style="font-size: 12px; opacity: 0.7;">Waiting for execution...</p>
                        <div class="status-indicator">
                            <span class="dot pulse"></span>
                            <span>CONNECTED</span>
                        </div>
                    </div>
                    <div class="mobile-home-indicator">
                        <div class="indicator-bar"></div>
                    </div>
                </div>
            </div>
        `,window.lucide&&(lucide.createIcons(),setTimeout(()=>lucide.createIcons(),500),setTimeout(()=>lucide.createIcons(),2e3)),t()}function t(){const e=new Date,i=document.getElementById("mobile-clock");i&&(i.innerText=e.getHours().toString().padStart(2,"0")+":"+e.getMinutes().toString().padStart(2,"0"))}setInterval(t,1e4);function n(){const e=document.getElementById("qr-image"),i=document.getElementById("qr-loader");if(!e)return;let o=window.location.href;(window.location.hostname==="localhost"||window.location.hostname==="127.0.0.1"||window.location.hostname.endsWith(".test"))&&(o="http://192.168.29.170:5173/");const w=`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(o)}&bgcolor=ffffff&color=0f172a&margin=1`;e.src=w,e.onload=()=>{e.style.display="block",i&&(i.style.display="none")},e.onerror=()=>{i&&(i.innerText="Failed to load QR")}}setTimeout(n,500),window.NativePHP={Window:{open:e=>s("Window::open()",`Simulation: Spawning native window "${e.title||"App"}" (${e.width||800}x${e.height||600}px)`)},Biometrics:{authenticate:()=>s("Biometric Auth","Scanning face/fingerprint in real-time...")},Notification:{show:(e,i)=>{l(e,i),"Notification"in window&&Notification.permission==="granted"&&new Notification(e,{body:i})}},Haptics:{impact:e=>{navigator.vibrate&&navigator.vibrate(e==="heavy"?[200]:[100]),r.classList.add("shake"),setTimeout(()=>r.classList.remove("shake"),400)}},Camera:{capture:async()=>{try{const e=await navigator.mediaDevices.getUserMedia({video:!0}),i=document.getElementById("mobile-viewport");i&&(i.innerHTML='<video autoplay playsinline style="width:100%; height:100%; object-fit:cover;"></video>',i.querySelector("video").srcObject=e)}catch{s("Camera Sync Failed",'Mobile browser blocked camera access. Note: Real camera access requires an HTTPS connection (like "herd share" or "expose share").')}}},Geolocation:{current:()=>{navigator.geolocation.getCurrentPosition(e=>{s("GPS Synchronized",`Coordinates: ${e.coords.latitude.toFixed(4)}, ${e.coords.longitude.toFixed(4)}`)},e=>s("GPS Error","Permission required for location simulation."))}},Dialog:{alert:e=>s("Native Alert",e),confirm:e=>confirm(e)}};function l(e,i){const o=document.createElement("div");o.className="mock-notification glass animate-in-right",o.innerHTML=`<div style="display:flex;gap:12px;align-items:center;"><div style="background:var(--accent-blue);width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;"><i data-lucide="bell" style="width:16px;color:white;"></i></div><div><div style="font-weight:700;font-size:13px;">${e}</div><div style="font-size:12px;color:var(--text-secondary);">${i}</div></div></div>`,document.body.appendChild(o),lucide.createIcons(),setTimeout(()=>{o.classList.add("fade-out"),setTimeout(()=>o.remove(),400)},4e3)}function s(e,i){const o=document.createElement("div");o.className="modal-overlay",o.innerHTML=`<div class="mock-dialog glass animate-in"><div style="font-weight:700;margin-bottom:12px;color:var(--accent-blue);font-size:1.1rem;font-family:var(--font-heading);">${e}</div><p style="margin-bottom:24px;color:var(--text-secondary);">${i}</p><button class="btn btn-primary" style="width:100%" onclick="this.closest('.modal-overlay').remove()">Dismiss</button></div>`,document.body.appendChild(o)}const f=document.querySelectorAll(".component-item");f.forEach(e=>e.addEventListener("click",()=>{f.forEach(o=>o.classList.remove("active")),e.classList.add("active");const i=u[e.dataset.type]||u.window;a&&a.setValue(i)}));const u={window:`<?php

use Native\\Laravel\\Facades\\Window;

Window::open()
    ->title('My Custom Screen')
    ->width(800)
    ->height(600);
`,dialog:`<?php

use Native\\Laravel\\Facades\\Dialog;

Dialog::alert('Hello from NativePHP!');`,notification:`<?php

use Native\\Laravel\\Facades\\Notification;

Notification::show('Sync Status', 'Your phone is connected to the Lab.');`,camera:`<?php

use Native\\Laravel\\Facades\\Camera;

Camera::capture();`,biometrics:`<?php

use Native\\Laravel\\Facades\\Biometrics;

Biometrics::authenticate();`,geolocation:`<?php

use Native\\Laravel\\Facades\\Geolocation;

Geolocation::current();`,haptics:`<?php

use Native\\Laravel\\Facades\\Haptics;

Haptics::impact('heavy');`},m=document.getElementById("run-btn");m&&m.addEventListener("click",()=>{if(!a)return;const e=a.getValue();m.innerHTML='<i data-lucide="refresh-cw" class="spin"></i> <span>Executing...</span>',lucide.createIcons(),setTimeout(()=>{m.innerHTML='<i data-lucide="play"></i> <span>Run Lab</span>',lucide.createIcons(),e.includes("Window::open")&&window.NativePHP.Window.open({title:"My Screen",width:800,height:600}),e.includes("Biometrics::authenticate")&&window.NativePHP.Biometrics.authenticate(),e.includes("Notification::show")&&window.NativePHP.Notification.show("Mobile Lab","Execution successful!"),e.includes("Camera::capture")&&window.NativePHP.Camera.capture(),e.includes("Geolocation::current")&&window.NativePHP.Geolocation.current(),e.includes("Haptics::impact")&&window.NativePHP.Haptics.impact("heavy"),e.includes("Dialog::alert")&&window.NativePHP.Dialog.alert("Application Message Trace")},600)});const v=document.getElementById("mobile-code-toggle"),g=document.querySelector(".editor-pane");v&&v.addEventListener("click",()=>{g.classList.toggle("show-mobile"),a&&setTimeout(()=>a.layout(),300)});const h=document.getElementById("mobile-plugins-btn"),p=document.getElementById("plugin-menu");h&&p&&(h.addEventListener("click",()=>{p.classList.add("active")}),p.querySelectorAll(".menu-item").forEach(e=>{e.addEventListener("click",()=>{const i=e.dataset.type,o=u[i]||u.window;a&&a.setValue(o),p.classList.remove("active"),g.classList.add("show-mobile"),a&&setTimeout(()=>a.layout(),300)})})),"Notification"in window&&Notification.permission==="default"&&Notification.requestPermission()})();
