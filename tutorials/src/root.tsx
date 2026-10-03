import React from 'react';
import {AbsoluteFill, Composition, interpolate, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';

type Shot = {heading: string; body: string; screen: string; detail: string; seconds: number; chapter?: string};

const iphone: Shot[] = [
  {heading: 'FireNexa na iPhoneu', body: 'Otvori firenexa.netlify.app i dodirni „Otvori aplikaciju”.', screen: 'Safari', detail: 'firenexa-app.netlify.app', seconds: 8},
  {heading: 'Otvori meni Dijeli', body: 'U Safariju dodirni ikonu Dijeli na traci preglednika.', screen: 'Safari • Dijeli', detail: '□↑  Dijeli', seconds: 8},
  {heading: 'Dodaj na početni ekran', body: 'Izaberi „Dodaj na početni ekran”. Meni se može razlikovati po verziji iOS-a.', screen: 'Safari • meni', detail: '＋  Dodaj na početni ekran', seconds: 9},
  {heading: 'Potvrdi instalaciju', body: 'Ako se ponudi „Otvori kao web aplikaciju”, ostavi uključeno i dodirni „Dodaj”.', screen: 'Početni ekran', detail: 'FireNexa     Dodaj', seconds: 9},
  {heading: 'Otvori novu ikonu', body: 'Pokreni FireNexa ikonu sa početnog ekrana i prijavi se svojim nalogom.', screen: 'FireNexa • prijava', detail: 'Prijavi se', seconds: 8},
  {heading: 'Uključi obavještenja', body: 'U aplikaciji otvori Podesavanja, uključi obavještenja i prihvati dozvolu iPhonea.', screen: 'FireNexa • Podesavanja', detail: 'Ukljuci operativne notifikacije', seconds: 9},
  {heading: 'Provjeri status', body: 'Za aktivne pozive prati i dogovoreni službeni kanal. Web Push zavisi od mreže i dozvola.', screen: 'FireNexa • status', detail: 'Ukljucene', seconds: 8},
];

const android: Shot[] = [
  {heading: 'FireNexa na Androidu', body: 'Otvori firenexa.netlify.app u Chromeu i dodirni „Otvori aplikaciju”.', screen: 'Chrome', detail: 'firenexa-app.netlify.app', seconds: 8},
  {heading: 'Otvori Chrome meni', body: 'Dodirni tri tačke u uglu Chromea.', screen: 'Chrome • meni ⋮', detail: '⋮  Više', seconds: 8},
  {heading: 'Izaberi instalaciju', body: 'Izaberi „Instaliraj aplikaciju” ili „Dodaj na početni ekran”. Naziv zavisi od uređaja.', screen: 'Chrome • meni', detail: '＋  Instaliraj aplikaciju', seconds: 9},
  {heading: 'Potvrdi korake', body: 'Potvrdi prikazane korake, pa otvori novu FireNexa ikonu.', screen: 'Android • instalacija', detail: 'Instaliraj', seconds: 8},
  {heading: 'Prijavi se', body: 'Unesi svoj nalog koji je povezan sa službom i ulogom.', screen: 'FireNexa • prijava', detail: 'Prijavi se', seconds: 8},
  {heading: 'Dozvoli obavještenja', body: 'U Podesavanjima aplikacije uključi obavještenja i prihvati dozvolu telefona.', screen: 'FireNexa • Podesavanja', detail: 'Ukljuci operativne notifikacije', seconds: 9},
  {heading: 'Provjeri status', body: 'Dostava zavisi od Chromea, mreže, uređaja i dozvola. Koristi i službeni kanal.', screen: 'FireNexa • status', detail: 'Ukljucene', seconds: 8},
];

const usage: Shot[] = [
  {chapter: 'Komandir', heading: 'Brzi poziv ekipe', body: 'Prijavi se kao komandir i provjeri aktivnu službu u zaglavlju.', screen: 'Poziv', detail: 'DVD Tivat • komandir', seconds: 9},
  {heading: 'Vrsta i naslov', body: 'Za vježbu izaberi VJEŽBA i upiši „TEST – nije stvarna intervencija”.', screen: 'Poziv • novi poziv', detail: 'VJEŽBA / TEST', seconds: 9},
  {heading: 'Lokacija i uputstvo', body: 'Upiši izmišljenu lokaciju i jasno uputstvo za okupljanje.', screen: 'Poziv • detalji', detail: 'Poligon (izmišljena lokacija)', seconds: 9},
  {heading: 'Izaberi službu', body: 'Prema svojim pravima izaberi DVD, SZS ili obje službe. Podobne članove bira server.', screen: 'Poziv • primaoci', detail: 'DVD   SZS   Obje', seconds: 10},
  {heading: 'Pregled prije slanja', body: 'Provjeri broj podobnih naloga i aktivnih push pretplata. To nije potvrda dostave.', screen: 'Poziv • potvrda', detail: 'Provjerite prije slanja', seconds: 10},
  {heading: 'Pošalji TEST poziv', body: 'Potvrdi tek kad su vrsta, lokacija, uputstvo i služba ispravni.', screen: 'Poziv • objava', detail: 'Objavi poziv', seconds: 9},
  {heading: 'Prati odziv', body: 'Pregledaj Dolazim, Dolazim kasnije, Ne mogu i članove bez odgovora.', screen: 'Poziv • odziv', detail: 'Dolaze  •  Kasne  •  Bez odgovora', seconds: 10},
  {heading: 'Zatvori poziv', body: 'Pri normalnom završetku opis je opcioni. Otkazivanje traži razlog.', screen: 'Poziv • završetak', detail: 'Zatvori intervenciju', seconds: 9},
  {chapter: 'Vatrogasac', heading: 'Otvori svoj poziv', body: 'Otvori obavještenje i pročitaj naslov, lokaciju i uputstvo.', screen: 'Moj poziv', detail: 'TEST • vježba', seconds: 9},
  {heading: 'Potvrdi dolazak', body: 'Dodirni „Dolazim”. Aplikacija čuva odgovor i posebno potvrđuje prijem.', screen: 'Moj poziv • odgovor', detail: 'Dolazim', seconds: 10},
  {heading: 'Ako kasniš ili ne možeš', body: 'Izaberi „Dolazim kasnije” i vrijeme, ili „Ne mogu”. Ovo su zasebni izbori.', screen: 'Moj poziv • izbor', detail: 'Dolazim kasnije   Ne mogu', seconds: 10},
  {heading: 'Kretanje i prisustvo', body: 'Prijava kretanja i potvrda prisustva su dva odvojena koraka.', screen: 'Moj poziv • teren', detail: 'Javite gdje ste → Prijavi prisustvo', seconds: 10},
  {heading: 'Pregledaj arhivu', body: 'Svoje odgovore i učešće možeš naknadno pregledati u Arhivi.', screen: 'Arhiva', detail: 'Moji pozivi i učešće', seconds: 9},
];

const F = 30;
const total = (shots: Shot[]) => shots.reduce((sum, shot) => sum + shot.seconds * F, 0);
const bg = '#071d2a';
const teal = '#16b9c0';

const Screen: React.FC<{shot: Shot; index: number; count: number}> = ({shot, index, count}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const enter = interpolate(frame, [0, 14], [35, 0], {extrapolateRight: 'clamp'});
  const opacity = interpolate(frame, [0, 12, durationInFrames - 12, durationInFrames], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const isBrowser = shot.screen.includes('Safari') || shot.screen.includes('Chrome') || shot.screen.includes('Android');
  return <AbsoluteFill style={{background: bg, color: '#f7fbfd', fontFamily: 'Arial, sans-serif', padding: '76px 80px', boxSizing: 'border-box', opacity}}>
    <div style={{display: 'flex', alignItems: 'center', gap: 20, color: teal, fontWeight: 800, fontSize: 34, letterSpacing: 2}}>
      <div style={{width: 48, height: 48, background: teal, borderRadius: 13, color: bg, textAlign: 'center', lineHeight: '48px'}}>F</div>
      FIRENEXA <span style={{marginLeft: 'auto', color: '#a8b9c3', fontSize: 24}}>{index + 1}</span>
    </div>
    {shot.chapter && <div style={{marginTop: 66, color: '#ffc66e', fontSize: 34, fontWeight: 700}}>{shot.chapter.toUpperCase()}</div>}
    <div style={{fontSize: 73, fontWeight: 800, lineHeight: 1.1, marginTop: shot.chapter ? 24 : 94, transform: `translateY(${enter}px)`}}>{shot.heading}</div>
    <div style={{fontSize: 36, lineHeight: 1.32, marginTop: 32, color: '#d6e6ed', minHeight: 158}}>{shot.body}</div>
    <div style={{position: 'absolute', top: 680, left: 171, width: 738, height: 945, border: '16px solid #314653', borderRadius: 78, background: '#eaf4f7', overflow: 'hidden', boxShadow: '0 34px 80px #0009', color: '#0b2636'}}>
      <div style={{height: 66, background: '#12323e', color: 'white', fontSize: 23, display: 'flex', justifyContent: 'space-between', padding: '16px 44px', boxSizing: 'border-box'}}><span>9:41</span><span>●●● ▰</span></div>
      <div style={{height: 104, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 32px', fontSize: 26, fontWeight: 700, borderBottom: '1px solid #d7e4e9'}}>{shot.screen}</div>
      <div style={{margin: '72px 34px 0', padding: '43px 35px', background: 'white', borderRadius: 27, borderLeft: `9px solid ${teal}`, boxShadow: '0 8px 22px #13405218'}}>
        <div style={{color: '#087889', fontWeight: 800, fontSize: 22, letterSpacing: 2}}>FIRENEXA · ILUSTRACIJA</div>
        <div style={{fontSize: 42, fontWeight: 800, marginTop: 33, lineHeight: 1.18}}>{isBrowser ? 'Instalacija aplikacije' : 'Testni prikaz aplikacije'}</div>
        <div style={{fontSize: 31, lineHeight: 1.32, marginTop: 23, color: '#3d5868'}}>{shot.heading}</div>
      </div>
      <div style={{margin: '34px', padding: '27px 30px', background: '#087d8e', color: 'white', borderRadius: 20, fontWeight: 750, textAlign: 'center', fontSize: 31, lineHeight: 1.25}}>{shot.detail}</div>
      <div style={{position: 'absolute', bottom: 19, left: 0, width: '100%', textAlign: 'center', color: '#45606f', fontSize: 23}}>Ilustracija • redosljed se može razlikovati</div>
    </div>
    <div style={{position: 'absolute', left: 80, bottom: 142, color: '#a6bdc8', fontSize: 26}}>firenexa.netlify.app</div>
    <div style={{position: 'absolute', left: 80, bottom: 95, height: 8, width: 920, borderRadius: 5, background: '#28505c'}}><div style={{height: '100%', width: `${100 * (index + 1) / count}%`, background: teal}} /></div>
  </AbsoluteFill>;
};

const Film: React.FC<{shots: Shot[]}> = ({shots}) => {
  let from = 0;
  return <AbsoluteFill>{shots.map((shot, index) => {const start = from; from += shot.seconds * F; return <Sequence key={index} from={start} durationInFrames={shot.seconds * F}><Screen shot={shot} index={index} count={shots.length}/></Sequence>;})}</AbsoluteFill>;
};

export const Root: React.FC = () => <>
  <Composition id="Iphone" component={Film} defaultProps={{shots: iphone}} durationInFrames={total(iphone)} fps={F} width={1080} height={1920}/>
  <Composition id="Android" component={Film} defaultProps={{shots: android}} durationInFrames={total(android)} fps={F} width={1080} height={1920}/>
  <Composition id="Usage" component={Film} defaultProps={{shots: usage}} durationInFrames={total(usage)} fps={F} width={1080} height={1920}/>
</>;
