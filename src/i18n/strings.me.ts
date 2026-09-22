/**
 * Crnogorski. The source of truth for every product-authored sentence.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS THE ONE THAT DEFINES THE SHAPE
 * ---------------------------------------------------------------------------
 *
 * `strings.en.ts` is typed `Strings`, which is `typeof me`. Adding a sentence
 * here without translating it is therefore a COMPILE ERROR, not a screen that
 * quietly shows Montenegrin to somebody who chose English. That is the whole
 * safety property of this arrangement, and it is free.
 *
 * Written in the Latin script WITHOUT diacritics, by the long-standing
 * convention of this interface. Repository documentation and code comments stay
 * in English.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT HERE
 * ---------------------------------------------------------------------------
 *
 * Anything a member typed or the database stored. Member names, intervention
 * titles, locations, instructions, closing notes and audit details are shown
 * exactly as they were written, in whatever language they were written in.
 * Translating a commander's note would be rewriting evidence.
 */

export const me = {
  app: {
    name: 'Boka Operativa',
    subtitle: 'Mobilizacija i evidencija',
    mark: 'BO',
  },

  serverErrors: {
    generic: "Server je odbio zahtjev. Promjena nije sacuvana.",
    permissionDenied: "Server je odbio zahtjev: nemate pravo pristupa.",
    unavailable: "Server trenutno nije dostupan. Provjerite vezu i pokusajte ponovo.",
    operations: {
      COMMAND_REQUIRED: "Nemate ovlascenje komandira za ovu radnju.",
      ADMIN_REQUIRED: "Nemate administratorsko ovlascenje za ovu radnju.",
      OWNER_REQUIRED: "Samo vlasnik moze ovo uraditi.",
      STAFF_REQUIRED: "Vas nalog nema operativni pristup.",
      MEMBER_RECORD_REQUIRED: "Vas nalog nije povezan sa clanom drustva.",
      NOT_A_RECIPIENT: "Niste na spisku pozvanih za ovu intervenciju.",
      INTERVENTION_NOT_FOUND: "Intervencija vise ne postoji.",
      INTERVENTION_NOT_OPEN: "Intervencija je zatvorena ili otkazana.",
      INTERVENTION_NOT_PUBLISHED: "Intervencija jos nije objavljena.",
      INTERVENTION_NOT_DRAFT: "Intervencija vise nije u pripremi.",
      VERSION_CONFLICT: "Neko je u medjuvremenu izmijenio ovu intervenciju. Osvjezite prikaz.",
      ALREADY_CHECKED_IN: "Vec ste prijavljeni na ovu intervenciju.",
      NOT_CHECKED_IN: "Niste prijavljeni, pa nema sta da se odjavi.",
      INTERVAL_NOT_FOUND: "Taj zapis prisustva vise ne postoji.",
      INTERVAL_REJECTED: "Taj zapis je odbijen. Prvo ga vratite u cekanje.",
      INTERVAL_CONFIRMED: "Taj zapis je vec potvrdjen. Prvo povucite potvrdu.",
      REASON_REQUIRED: "Razlog je obavezan i mora imati najmanje dva znaka.",
      VEHICLE_NOT_FOUND: "Vozilo vise ne postoji.",
      VEHICLE_NOT_IN_SERVICE: "Vozilo nije u upotrebi.",
      VEHICLE_ALREADY_OUT: "To vozilo je vec na terenu.",
      VEHICLE_ALREADY_RETURNED: "Povratak tog vozila je vec zabiljezen.",
      MOVEMENT_NOT_FOUND: "Taj izlazak vozila vise ne postoji.",
      INVALID_PROGRESS: "Nepoznat status kretanja.",
      INVALID_ANSWER: "Nepoznat odgovor.",
      INVALID_KIND: "Nepoznata vrsta intervencije.",
      INVALID_COORDINATES: "Koordinate nisu ispravne.",
      INVALID_INTERVAL: "Kraj mora biti poslije pocetka.",
      ETA_REQUIRED: "Izaberite za koliko stizete.",
      TITLE_REQUIRED: "Naslov mora imati najmanje tri znaka.",
      INSTRUCTIONS_REQUIRED: "Uputstvo mora imati najmanje tri znaka.",
      LOCATION_REQUIRED: "Lokacija je obavezna.",
      KIND_NOTE_REQUIRED: "Za vrstu \"Drugo\" upisite kratak opis.",
      IDEMPOTENCY_KEY_REQUIRED: "Nedostaje kljuc zahtjeva. Pokusajte ponovo.",
      NO_RECIPIENTS: "Izaberite bar jednog clana.",
      NO_ACTIVE_RECIPIENTS: "Nijedan izabrani clan nije aktivan.",
      NO_INTERVALS: "Nema izabranih zapisa.",
      TOO_MANY_INTERVALS: "Previse zapisa odjednom. Podijelite na manje grupe.",
      AVAILABILITY_REQUIRED: "Izaberite dostupnost.",
      NOTE_TOO_LONG: "Napomena je preduga.",
      CORRECTION_WOULD_OVERLAP: "Ispravka bi se preklopila sa drugim zapisom istog clana.",
      OPEN_ATTENDANCE_INTERVALS: "Neki clanovi su jos prijavljeni. Potvrdite da ih ostavljate otvorene.",
    },
    roster: {
      ADMIN_REQUIRED: "Server je odbio zahtjev: samo administrator ili vlasnik moze mijenjati evidenciju.",
      COMMAND_REQUIRED: "Server je odbio zahtjev: potrebna su komandna prava.",
      MEMBER_ALREADY_LINKED: "Taj clan vec ima povezan nalog. Prvo razvezite postojeci.",
      ACCOUNT_ALREADY_LINKED: "Taj nalog je vec povezan sa drugim clanom.",
      MEMBER_NOT_FOUND: "Clan vise ne postoji. Osvjezite spisak.",
      GROUP_NOT_FOUND: "Grupa vise ne postoji. Osvjezite spisak.",
      VEHICLE_NOT_FOUND: "Vozilo vise ne postoji. Osvjezite spisak.",
      ACCOUNT_NOT_FOUND: "Nalog vise ne postoji. Osvjezite spisak.",
      GROUP_NAME_TAKEN: "Grupa sa tim imenom vec postoji.",
      CALLSIGN_TAKEN: "Vozilo sa tom oznakom vec postoji.",
      CALLSIGN_REQUIRED: "Oznaka vozila je obavezna.",
      FULL_NAME_REQUIRED: "Ime i prezime moraju imati najmanje dva znaka.",
      NAME_REQUIRED: "Naziv je obavezan i mora imati najmanje dva znaka.",
      REASON_REQUIRED: "Razlog je obavezan i mora imati najmanje dva znaka.",
    },
  },

  live: {
    OFF: 'Automatsko osvjezavanje nije ukljuceno',
    CONNECTING: 'Povezivanje sa serverom...',
    LIVE: 'Uzivo - promjene stizu same',
    POLLING: 'Osvjezavanje na svakih 12 sekundi',
  },

  accountAccess: {
    kicker: 'Nalog na serveru', title: 'Prijava i pristup',
    notConfigured: 'Server nije podesen. Operativne funkcije nijesu dostupne dok se ne poveze server.',
    checking: 'Provjeravam pristup na serveru...',
    serverUnavailable: 'Server trenutno nije dostupan, pa prava pristupa ne mogu biti provjerena. Aplikacija ne dodjeljuje pristup dok provjera ne uspije.',
    accountBroken: 'Nalog postoji, ali profil nije pronadjen. Obratite se vlasniku sistema.',
    signIn: 'Prijavi se', register: 'Napravi nalog', email: 'Email', password: 'Lozinka',
    confirmPassword: 'Ponovite lozinku', phone: 'Broj telefona', birthDate: 'Datum rodjenja',
    phoneHint: 'Unesite crnogorski broj sa pocetnom nulom ili puni medjunarodni broj, na primjer +382 67 123 456.',
    passwordHint: 'Najmanje 12 znakova.', invalidFullName: 'Unesite ime i prezime.',
    invalidPhone: 'Unesite ispravan broj telefona.',
    invalidBirthDate: 'Unesite ispravan datum rodjenja koji nije u buducnosti.',
    passwordMismatch: 'Lozinke nijesu iste.',
    invalidEmail: 'Unesite ispravnu email adresu.', shortPassword: 'Lozinka mora imati najmanje 12 znakova.',
    wait: 'Molimo sacekajte...', noAccount: 'Nemam nalog', haveAccount: 'Vec imam nalog',
    requestReceived: 'Zahtjev je primljen. Ako je ovo nova adresa, provjerite email za potvrdu. Ako nalog vec postoji, prijavite se postojecom lozinkom.',
    profileRequired: 'Dopunite ime i prezime, broj telefona i datum rodjenja da bi vlasnik mogao provjeriti ko trazi pristup.',
    fullName: 'Ime i prezime', displayOnly: 'Prikazni podatak. Ne daje operativna prava.',
    saveProfile: 'Sacuvaj profil', saving: 'Cuvam...', signOut: 'Odjavi se',
    profileSaveFailed: 'Profil nije sacuvan. Provjerite podatke i pokusajte ponovo.',
    resetUnavailable: 'Promjena zaboravljene lozinke jos nije dostupna. Nakon podesavanja emaila vlasnik moze poslati jednokratni kod.',
    suspended: 'Pristup ovom nalogu je ukinut. Razlog je zapisan na serveru; obratite se vlasniku sistema.',
    citizenAccess: 'Nalog je aktivan kao gradjanski nalog. Dostupni su samo sopstveni nalog i podesavanja; operativni DVD i SZS podaci nijesu vidljivi. Vlasnik moze naknadno dodijeliti DVD, SZS ili obje sluzbe.',
    szsMembershipActive: '{organization} clanstvo je aktivno sa ulogom {role}. SZS operativni podaci jos nijesu otvoreni u ovoj fazi, a DVD podaci ostaju nedostupni bez DVD uloge.',
    signedInAs: 'Prijavljeni nalog', serverRole: 'DVD operativna uloga',
    servicesAndRoles: 'Sluzbe i uloge', noServiceMembership: 'Nema dodijeljenu sluzbu',
    checkingServices: 'Provjeravam sluzbe i uloge...',
    servicesUnavailable: 'Sluzbe i uloge trenutno nijesu mogle biti provjerene. Pokusajte ponovo; aplikacija ne pretpostavlja pristup.',
    roleFromServer: 'Uloge je dao server pri posljednjoj provjeri. Aplikacija ih ne pamti i ne pretpostavlja.',
    checkAgain: 'Provjeri pristup ponovo', retry: 'Pokusaj ponovo',
    unknownRole: 'Nepoznata uloga',
    credentialError: 'Prijava nije uspjela. Provjerite email i lozinku, pa pokusajte ponovo.',
    networkError: 'Server nije dostupan. Zahtjev nije stigao do servera ili odgovor nije primljen. Provjerite internet vezu i pokusajte ponovo.',
    networkBlocked: 'Server i dalje nije dostupan. Ako ste inace na internetu, zahtjev mozda blokira dodatak za blokiranje sadrzaja, zastita privatnosti u pregledacu ili mreza na kojoj ste. Mozete pokusati sa drugog pregledaca ili druge mreze, ili pitati vlasnika sistema.',
  },

  recovery: {
    forgot: 'Zaboravljena lozinka',
    title: 'Promjena zaboravljene lozinke',
    intro: 'Unesite email naloga. Ako nalog postoji, na tu adresu stize jednokratni kod.',
    send: 'Posalji kod',
    received: 'Zahtjev je primljen. Ako nalog postoji, provjerite email i unesite kod. Isti odgovor se prikazuje za svaku adresu.',
    code: 'Kod iz emaila',
    newPassword: 'Nova lozinka',
    confirmPassword: 'Ponovite novu lozinku',
    save: 'Promijeni lozinku',
    resend: 'Posalji novi kod',
    changeEmail: 'Promijeni email',
    cooldown: 'Novi kod mozete traziti za {seconds} s.',
    invalidCode: 'Kod nije ispravan ili je istekao. Provjerite kod ili zatrazite novi.',
    mismatch: 'Lozinke nijesu iste.',
    updateFailed: 'Lozinka mozda nije promijenjena. Pokusajte se prijaviti novom lozinkom ili zatrazite novi kod.',
    done: 'Lozinka je promijenjena. Mozete se prijaviti novom lozinkom.',
    back: 'Nazad na prijavu',
  },

  accounts: {
    pageTitle: 'Nalozi i pristup', ownerOnly: 'Samo vlasnik sistema', allAccounts: 'Registrovani nalozi',
    accountCount: 'Broj naloga: {count}', risk: 'Ovo su nalozi na serveru. Promjene sluzbe, uloge i pristupa odmah stupaju na snagu i ostaju u evidenciji.',
    search: 'Pretrazi po imenu, emailu, sluzbi, ulozi ili statusu', loading: 'Ucitavam naloge sa servera...',
    noResults: 'Nema rezultata', noAccounts: 'Server nije vratio nijedan nalog.', changeSearch: 'Promijenite pojam za pretragu.',
    account: 'Nalog', status: 'Status', role: 'Uloga', access: 'Pristup', noName: 'Ime nije uneseno',
    ownAccountLocked: 'Sopstveni nalog se ne mijenja odavde.', ownerLocked: 'Vlasnicki nalog je zasticen.',
    reasonForAccess: 'Razlog za promjenu pristupa', reasonRequired: 'Razlog (obavezno)',
    revokeAccess: 'Ukini pristup', restoreAccess: 'Vrati pristup', reasonMissing: 'Razlog je obavezan. Upisite zasto mijenjate pristup.',
    changedRole: 'Uloga je promijenjena u: {role}.', changeFailed: 'Promjena nije sacuvana.', reasonNeeded: 'Razlog je obavezan.',
    organizationLabel: { DVD: 'DVD Tivat', SZS: 'Sluzba zastite i spasavanja Tivat' },
    noMembership: 'Nije clan',
    changedMembership: '{organization}: {role}.',
    membershipChanged: '{organization} - uloga: {role}',
    resetReady: 'Vlasnik moze poslati jednokratni kod na registrovani email. Lozinka se ne prikazuje i ne postavlja iz admin panela.',
    resetUnavailable: 'Slanje koda je spremno, ali je iskljuceno dok SMTP i stvarna dostava emaila ne prodju provjeru.',
    sendReset: 'Posalji reset kod', resetSentShort: 'Kod je poslat',
    resetSent: 'Zahtjev je poslat na registrovani email korisnika.',
    resetFailed: 'Kod nije mogao biti poslat. Provjerite email servis i pokusajte ponovo.',
    multiServicePending: 'DVD upravljanje je aktivno. SZS dodjela ce se otkljucati tek nakon provjere nove baze, da SZS nalog ne bi mogao vidjeti DVD podatke.',
    multiServiceReady: 'Dodjela sluzbi je aktivna. Svaki nalog pocinje kao gradjanin; vlasnik zatim moze dodijeliti DVD, Sluzbu zastite i spasavanja ili obje sluzbe. SZS uloga ne otvara DVD operativne podatke.',
    accessRestored: 'Pristup je vracen.', accessRevoked: 'Pristup je ukinut.',
    auditKicker: 'Trajna evidencija', auditTitle: 'Promjene sluzbe, uloga i pristupa', noAudit: 'Jos nema zapisa',
    auditHint: 'Evidencija se popunjava kada se promijeni clanstvo, uloga ili pristup.',
    roleChanged: 'uloga {from} → {to}', roleChangedTo: 'uloga postavljena: {role}',
    accessChange: 'pristup vracen', accessRemoval: 'pristup ukinut',
    registration: 'Registracija', registrationTitle: 'Kako novi nalog dobija pristup',
    emailPassword: 'Email i lozinka', accountCreatedByUser: 'Korisnik sam kreira nalog.',
    nameAndSurname: 'Licni i kontakt podaci', displayNotProof: 'Ime i prezime, telefon i datum rodjenja. Podaci ne daju operativna prava.',
    phoneAndBirthDate: 'Telefon i datum rodjenja',
    linkedMember: 'Povezan sa evidencijom clana', notLinkedMember: 'Nije povezan sa clanom',
    openRoster: 'Otvori Evidenciju',
    citizenAccessLabel: 'Gradjanski pristup', noRights: 'Novi nalog vidi samo sopstveni nalog i podesavanja; nema operativne podatke.',
    ownerDecision: 'Odluka vlasnika', ownerAssigns: 'Samo vlasnik moze dodijeliti DVD, SZS ili obje sluzbe.',
    serverCheck: 'Provjera na serveru', serverChecksRole: 'Server provjerava ulogu pri svakom zahtjevu.',
    roleLabel: { OWNER: 'Vlasnik sistema', ADMIN: 'Administrator', COMMANDER: 'Komandir', FIREFIGHTER: 'Vatrogasac', PENDING: 'Ceka odobrenje (stara oznaka)', CITIZEN: 'Gradjanin' },
    statusLabel: { UNKNOWN: 'Nepoznato', PROFILE_REQUIRED: 'Profil nije zavrsen', ACTIVE: 'Aktivan', SUSPENDED: 'Pristup ukinut' },
    loadFailed: 'Spisak naloga nije mogao biti ucitan sa servera.',
    commandErrors: {
      ownerRequired: 'Server je odbio zahtjev: samo vlasnik sistema moze mijenjati pristup.',
      ownAccount: 'Vlasnik ne moze mijenjati sopstveni nalog. Time bi mogao sam sebe zakljucati.',
      protectedAccount: 'Vlasnicki nalog je zasticen i ne moze se mijenjati iz aplikacije.',
      roleNotAssignable: 'Ta uloga se ne moze dodijeliti.',
      reasonRequired: 'Razlog je obavezan i mora imati najmanje dva znaka.',
      accountNotFound: 'Nalog vise ne postoji. Osvjezite spisak.',
      organizationNotFound: 'Sluzba ne postoji ili trenutno nije aktivna.',
      generic: 'Server je odbio zahtjev. Promjena nije sacuvana.',
    },
  },

  organisation: {
    pageTitle: 'Evidencija drustva', adminOnly: 'Samo administrator ili vlasnik',
    signInFirst: 'Prijavite se da biste vidjeli evidenciju.',
    denied: 'Evidenciju odrzava administrator ili vlasnik. Komandir vodi intervencije, ali ne mijenja sastav drustva.',
    serverData: 'Podaci sa servera', tabs: 'Dio evidencije', members: 'Clanovi', groups: 'Grupe', vehicles: 'Vozila',
    loading: 'Ucitavanje evidencije...', loadFailed: 'Evidencija nije mogla biti ucitana sa servera.',
    changeFailed: 'Promjena nije sacuvana.', unreadyOne: 'Jedan clan ne moze primiti poziv.', unreadyMany: '{count} clanova ne moze primiti poziv.',
    unreadyExplain: 'Provjerite aktivno stanje i povezani nalog svakog oznacenog clana.',
    newMember: 'Ime i prezime novog clana', addMember: 'Dodaj clana', memberAdded: 'Clan je dodat.', noMembers: 'Nema unesenih clanova',
    addFirstMember: 'Dodajte prvog clana da biste mogli uputiti intervenciju.', memberList: 'Spisak clanova',
    account: 'Nalog', state: 'Stanje', action: 'Radnja', linked: 'Povezan', notLinked: 'Nije povezan',
    linkAccount: 'Povezi nalog sa clanom', linkAccountOption: 'Povezi nalog...', accountLinked: 'Nalog je povezan sa clanom.',
    unlinkAccount: 'Razvezi nalog', unlinkReason: 'Razlog razvezivanja naloga clana', accountUnlinked: 'Nalog je razvezan od clana.',
    compositionReason: 'Razlog promjene sastava za', removeFromRoster: 'Van sastava', restoreToRoster: 'Vrati u sastav',
    removedFromRoster: 'Clan je van sastava.', restoredToRoster: 'Clan je vracen u sastav.',
    newGroup: 'Naziv nove grupe', addGroup: 'Dodaj grupu', groupAdded: 'Grupa je dodata.', noGroups: 'Nema unesenih grupa',
    groupsHint: 'Grupe omogucavaju da poziv uputite ekipi umjesto pojedinacnim clanovima.',
    addMembersFirst: 'Dodajte clanove prije nego sto ih rasporedite u grupe.', removedFromGroup: 'Clan je uklonjen iz grupe.', addedToGroup: 'Clan je dodat u grupu.',
    vehiclePrivacy: 'Unesite oznaku, naziv i vrstu vozila. Registarske oznake i drugi osjetljivi podaci nijesu dio ove evidencije.',
    callsign: 'Oznaka', vehicleName: 'Naziv vozila', kind: 'Vrsta', vehicleKindHint: 'Na primjer: navalno, cisterna ili tehnicko.', addVehicle: 'Dodaj vozilo', noVehicles: 'Nema unesenih vozila', vehicleList: 'Spisak vozila',
    inService: 'U upotrebi', outOfService: 'Van upotrebe', vehicleReason: 'Razlog promjene stanja za vozilo', vehicleAdded: 'Vozilo je dodato.', vehicleTakenOut: 'Vozilo je van upotrebe.', vehicleRestored: 'Vozilo je u upotrebi.',
    readiness: { READY: 'Moze primiti poziv', NO_ACCOUNT: 'Nema povezan nalog', INACTIVE: 'Van sastava' },
    tableMembers: 'Clanovi drustva i stanje njihovih naloga', tableVehicles: 'Vozila drustva',
    reason: 'Razlog',
  },

  nav: {
    /** The two task groups a person actually works in. */
    groupWork: 'Rad',
    groupSociety: 'Drustvo',
    main: 'Glavna navigacija',
    workspace: 'Boka Operativa',
    skipToContent: 'Preskoci na sadrzaj',
  },

  routes: {
    poziv: { name: 'Poziv', description: 'Priprema, objava i vodjenje stvarne intervencije' },
    mobilizacija: { name: 'Moj poziv', description: 'Vasa dostupnost, vas poziv i vase prisustvo' },
    arhiva: { name: 'Arhiva', description: 'Zapis zavrsenih intervencija i potvrdjeno ucesce' },
    evidencija: { name: 'Evidencija', description: 'Stvarni clanovi, grupe i vozila drustva na serveru' },
    nalozi: { name: 'Nalozi', description: 'Stvarni nalozi na serveru: prijava, uloge i ukidanje pristupa' },
    podesavanja: { name: 'Podesavanja', description: 'Jezik i obavjestenja na ovom uredjaju' },
    prikaz: { name: 'Prikaz u bazi', description: 'Simulacija: pregled stanja namijenjen ekranu u bazi' },
    dojava: {
      name: 'Prijava gradjana',
      description: 'Napusteni istrazivacki prototip. Nije kanal za prijavu hitnih slucajeva',
    },
    dezurni: { name: 'Dezurni', description: 'Simulacija: priprema poziva i pracenje odziva ekipe' },
    clan: { name: 'Clan', description: 'Simulacija: poziv i odgovor iz ugla izabranog clana' },
    vozila: { name: 'Vozila', description: 'Simulacija: rucna evidencija izlaska i povratka vozila' },
    clanovi: { name: 'Clanovi', description: 'Simulacija: clanovi, uloge, grupe i osposobljenosti' },
    istorija: { name: 'Istorija', description: 'Simulacija: zavrsene vjezbe i hronologija promjena' },
  },

  shell: {
    identityLoading: 'Provjera pristupa...',
    identityNotConfigured: 'Lokalni prototip',
    identityNotSignedIn: 'Niste prijavljeni',
    identityServerUnreachable: 'Server nedostupan',
    identityNoRole: 'Gradjanin / bez DVD uloge',
    identitySuspended: 'Pristup ukinut',
    loadingView: 'Ucitavanje prikaza...',

    /**
     * The server-backed screens run against the real database, so the
     * simulation wording would be false there - it would say roles are
     * simulated on the screens where they are not. A banner that is wrong in
     * that direction is worse than no banner, because it teaches people to
     * ignore it everywhere else.
     */
    serverBadge: 'STVARNI PODACI',
    serverBadgeText:
      'Ovaj ekran radi na serveru. Prijava, uloga i pristup se provjeravaju pri svakom zahtjevu.',
    simulationBadge: 'SIMULACIJA',
    simulationBadgeText:
      'Izmisljeni podaci u ovom pregledacu. Nema push, SMS ni telefonskih poziva, i nema provjere prava.',
    simulationNotice:
      'Ovaj ekran jos radi na lokalnoj simulaciji: podaci su izmisljeni, cuvaju se samo u ovom pregledacu i biraju se preko izbora simuliranog ucesnika. Server ne ucestvuje i ovdje nema provjere prava.',
    simulationBackToWork: 'Stvarni rad je u grupi Rad.',
    simulatedActor: 'Simulirani ucesnik',
    simulatedActorHint: 'Demonstracija. Ovo nije prijava i ne daje nikakva prava.',

    footerServer: 'Ovaj ekran radi na serveru; ko ste odredjuje prijava, ne izbor ucesnika.',
    footerServerData:
      'Podaci na ovom ekranu se citaju i upisuju na server, uz provjeru prava pri svakom zahtjevu. Za prikaz se koriste iskljucivo izmisljeni clanovi i izmisljeni podaci.',
    footerLocalData:
      'Podaci se cuvaju samo u ovom pregledacu, na ovom uredjaju. Nista se ne sinhronizuje izmedju uredjaja niti se salje na server. Brisanje podataka pregledaca brise i ovo.',
  },

  settings: {
    title: 'Podesavanja',
    lead: 'Vazi samo za ovaj uredjaj i ovaj pregledac. Nista odavde se ne salje na server.',

    languageTitle: 'Jezik',
    languageHint: 'Mijenja jezik korisnickog interfejsa. Ne mijenja ono sto su clanovi upisali.',
    languageLegend: 'Izaberite jezik',
    languageSaved: 'Jezik je sacuvan na ovom uredjaju.',
    languageNotSaved:
      'Jezik je promijenjen, ali ga ovaj pregledac ne moze zapamtiti. Ponovnim ucitavanjem vraca se na Crnogorski.',
    contentNotTranslated:
      'Naslovi intervencija, imena clanova, uputstva i biljeske prikazuju se onako kako su upisani, na jeziku na kojem su napisani.',

    notificationsTitle: 'Obavjestenja na ovom uredjaju',
    displayTitle: 'Vrijeme i prikaz',
    displayZone: 'Sva vremena se prikazuju po vremenu Crne Gore, bez obzira na podesavanja uredjaja.',
    displayZoneMissing:
      'Ovaj pregledac nema podatke o vremenskim zonama, pa se vremena ne mogu prikazati pouzdano.',

    prototypeTitle: 'Prototip i simulacija',
    prototypeSummary: 'Prikazi ekrane simulacije',
    prototypeWarning:
      'Ovi ekrani su stara simulacija. Podaci su izmisljeni, cuvaju se samo u ovom pregledacu i nemaju veze sa stvarnim pozivima. Ne koristite ih tokom stvarne intervencije.',

    aboutTitle: 'O aplikaciji',
    aboutFallback:
      'Ovo nije zamjena za pozivanje zvanicne vatrogasne sluzbe. Kod pozara ili nesrece odmah pozovite hitni telefonski broj.',
    aboutStorage: 'Podesavanja ovog uredjaja',
    aboutStorageValue: 'Cuvaju se lokalno, u ovom pregledacu',
  },

  gate: {
    loadingAccess: 'Provjera pristupa...',
    loadingOperational: 'Ucitavanje operativnih podataka...',
    retry: 'Pokusaj ponovo',
    recheck: 'Provjeri ponovo',
    recheckAccess: 'Provjeri pristup ponovo',
    goToSignIn: 'Idi na prijavu',
    completeProfile: 'Dopuni profil',

    wrongRoleTitle: 'Ovaj ekran nije za vasu ulogu.',
    wrongRoleSignedInAs: 'Prijavljeni ste kao',
    wrongRoleUsedBy: 'Ovaj ekran koriste:',
    wrongRoleServerWouldRefuse: 'Server bi svaku radnju odavde ionako odbio.',

    notConfiguredTitle: 'Ova kopija nije povezana sa serverom.',
    notConfiguredText:
      'Operativni ekrani rade samo kada su podeseni pristupni podaci projekta. Prototip i dalje radi lokalno.',

    signInRequiredTitle: 'Prijavite se da biste vidjeli ovaj ekran.',
    signInRequiredText: 'Operativni podaci se citaju sa servera tek kada server potvrdi ko ste.',

    serverUnreachableTitle: 'Server nije dostupan.',
    serverUnreachableText:
      'Ne prikazujemo nista umjesto stvarnog stanja, jer zastarjeli podaci na intervenciji su gori od praznog ekrana.',

    dataUnavailableTitle: 'Server trenutno nije dostupan.',
    dataUnavailableText: 'Podaci nisu ucitani, pa ovaj ekran ne prikazuje stanje.',

    accountBrokenTitle: 'Nalog nije potpun.',
    accountBrokenText: 'Server nema vas profil. Javite se vlasniku naloga - ovo se ne popravlja iz aplikacije.',

    profileRequiredTitle: 'Dopunite profil.',
    profileRequiredText: 'Upisite ime i prezime da bi vas server mogao prepoznati kao clana.',

    suspendedTitle: 'Vas pristup je ukinut.',
    suspendedText:
      'Operativni ekrani su zatvoreni, a server odbija svaku radnju. Razlog i vrijeme su zabiljezeni; javite se vlasniku naloga.',

    noDvdRoleTitle: 'Ovaj nalog nema DVD operativnu ulogu.',
    noDvdRoleText: 'Dostupni su nalog i podesavanja. Vlasnik moze dodijeliti DVD, SZS ili obje sluzbe; samo SZS clanstvo ne otvara DVD operativne podatke.',

    noMemberTitle: 'Vas nalog nije povezan sa clanom drustva.',
    noMemberText:
      'Zbog toga vas ne mozemo staviti na spisak pozvanih, niti mozete prijaviti svoje prisustvo. Administrator to povezuje na ekranu Evidencija.',
    noMemberUntilThen: 'Do tada ovaj ekran nema sta da prikaze za vas.',

    // Ove dvije recenice postoje da se NE bi reklo "niste clan" kada provjera
    // uopste nije izvrsena. Prva je kvar servera i ponovni pokusaj ima smisla;
    // druga je odbijanje - server je odgovorio i rekao ne, pa ponovni pokusaj
    // nikada nece pomoci i popravlja se dodjelom prava, ne cekanjem.
    memberCheckFailedTitle: 'Nismo mogli provjeriti vas clanski zapis.',
    memberCheckFailedText:
      'Server nije odgovorio na tu provjeru. Ovo ne znaci da niste clan drustva - znaci da ne znamo.',
    memberCheckRefusedTitle: 'Server je odbio provjeru vaseg clanskog zapisa.',
    memberCheckRefusedText:
      'Server je odgovorio i odbio provjeru, pa ponovni pokusaj nece pomoci. Ovo nije podatak o tome da li ste clan drustva. Javite se vlasniku naloga - rjesava se pravima pristupa na serveru.',
  },

  /**
   * The two things a person needs to know about the APPLICATION rather than
   * about the intervention: this device has no connection, and a new version is
   * waiting.
   *
   * These were written straight into `ConnectionBar` and never left it, so they
   * stayed Montenegrin on an English screen - on every operational screen, and
   * on the one state where being understood matters most. "Offline" on its own
   * is a status; "what you enter now will not be saved" is the fact somebody at
   * an incident actually needs.
   */
  connection: {
    offlineTitle: 'Uredjaj nije na mrezi.',
    offlineText:
      'Operativni ekrani ne mogu da procitaju stanje sa servera, a sve sto sada unesete nece biti sacuvano. Cim se veza vrati, pokusajte ponovo.',
    updateTitle: 'Nova verzija je spremna.',
    updateText:
      'Primjenjuje se tek kada vi to zatrazite, da se aplikacija ne bi promijenila usred rada.',
    updateAction: 'Osvjezi aplikaciju',
  },

  push: {
    eyebrow: 'OPERATIVNA UZBUNA',
    title: 'Notifikacije za novi poziv',
    stateOn: 'Ukljucene',
    stateOff: 'Iskljucene',
    stateChecking: 'Provjera...',

    enable: 'Ukljuci operativne notifikacije',
    disable: 'Iskljuci na ovom uredjaju',
    openSettings: 'Podesavanja',

    installOnIos: 'Na iPhoneu prvo izaberite Podijeli - Dodaj na pocetni ekran, otvorite Boka Operativa sa te ikone, pa ovdje ukljucite notifikacije.',
    unsupported: 'Ovaj pregledac ne podrzava pouzdane Web Push notifikacije.',
    notConfigured: 'Push servis jos nije povezan sa ovom objavljenom verzijom.',
    denied: 'Notifikacije su odbijene u podesavanjima telefona. Dozvolite ih za Boka Operativa, pa otvorite aplikaciju ponovo.',
    failed: 'Notifikacija nije podesena. Provjerite vezu i pokusajte ponovo.',

    /*
     * Svaki od ovih razloga se ranije prikazivao kao "provjerite vezu", pa je
     * covjek trazio gresku tamo gdje je nije bilo. Server koji je objasnio
     * zasto je odbio nikada nije problem sa vezom.
     */
    memberRequired:
      'Vas nalog jos nije povezan sa clanom drustva, pa ne moze primati operativni poziv. Otvorite Evidencija - Clanovi, dodajte svoj clanski zapis i povezite ga sa ovim nalogom.',
    accessRequired:
      'Vas nalog nema operativnu ulogu, pa ne moze primati poziv. Obratite se vlasniku sistema.',
    deviceRejected:
      'Server je odbio podatke ovog uredjaja. To je greska u aplikaciji, ne u telefonu - prijavite je.',
    serverRefused:
      'Server je odbio prijavu ovog uredjaja i nije dao razlog koji ova verzija prepoznaje. Veza radi.',
    subscriptionConflict:
      'Ovaj uredjaj je vec prijavljen na drugi nalog. Odjavite taj nalog na ovom uredjaju, pa pokusajte ponovo.',
    unreachable: 'Server nije dostupan. Provjerite vezu i pokusajte ponovo.',

    /**
     * Never a promise. A push service accepting a message is not a phone
     * ringing, and silent mode, Focus and Do Not Disturb all outrank this
     * application on the member's own device.
     */
    enabledExplanation:
      'Ovaj uredjaj je prijavljen za operativni poziv. Sistem ce pokusati da prikaze upozorenje i kada aplikacija nije otvorena. Zvuk i vibracija zavise od podesavanja telefona i mogu izostati.',
    privacyExplanation:
      'Upozorenje ne otkriva lokaciju ni detalje na zakljucanom ekranu. Otvaranje notifikacije vodi u prijavljenu aplikaciju i konkretan poziv.',
    fallbackReminder:
      'Push je dodatni nacin obavjestavanja i nije zamjena za telefon ili Viber. Za stvarnu uzbunu i dalje vazi dogovoreni telefonski poziv.',
  },

  timings: {
    nobodyInvited: 'Niko nije pozvan na ovu intervenciju',
    perMemberLabel: 'Vremena odziva po clanu',
    colMember: 'Clan',
    colOpened: 'Otvaranje',
    colAnswer: 'Odgovor',
    colMovement: 'Kretanje',
    colArrival: 'Dolazak',
    colAttendance: 'Prisustvo',

    factTime: 'Vrijeme',
    factSincePublication: 'Od objave',
    factSinceOpening: 'Od otvaranja',
    /** The member's own estimate, never a measurement, and labelled so. */
    factEstimate: 'Najavio (procjena)',
    factReported: 'Javljeno',
    factOnScene: 'Na licu mjesta',
    factCheckIn: 'Prijava',
    factCheckOut: 'Odjava',
    factStillCheckedIn: 'Jos je prijavljen',
    factConfirmed: 'Potvrdjeno',
    factAwaitingConfirmation: 'Ceka potvrdu',
    factRejected: 'Odbijeno',
    minutesShort: 'min',

    societyTitle: 'Vremena odziva drustva',
    societyNote:
      'Svako vrijeme je mjereno od objave poziva, iz vremena koje je upisao server. Prvi dogadjaj je izabran po vremenu, nikada po redoslijedu u spisku.',
    firstOpen: 'Prvo otvaranje poziva',
    firstAnswer: 'Prvi odgovor',
    /** Not the same as the first answer: somebody may have declined first. */
    firstComing: 'Prvi odgovor Dolazim',
    firstArrive: 'Prvi dolazak na lice mjesta',
    firstCheckIn: 'Prva prijava prisustva',
    firstVehicle: 'Prvi izlazak vozila',

    durationTitle: 'Trajanje intervencije',
    published: 'Objavljeno',
    closed: 'Zatvoreno',
    stillRunning: 'Jos traje',
    totalDuration: 'Ukupno trajanje',
    totalConfirmed: 'Ukupno potvrdjeno ucesce',
    statePeriodsLabel: 'Vrijeme provedeno u svakom stanju',
    colState: 'Stanje',
    colFrom: 'Od',
    colTo: 'Do',
    colDuration: 'Trajanje',
    colChangedBy: 'Promijenio',
    /** The first period was created by publishing, not entered by a transition. */
    byPublication: 'Objavom poziva',

    countsTitle: 'Odziv u brojkama',
    countsNote:
      'Svaka brojka je svoja cinjenica. Ko je otvorio poziv nije ko je odgovorio, ko je odgovorio nije ko je dosao, a prijavljeno prisustvo nije potvrdjeno prisustvo.',
    tallyInvited: 'Pozvano',
    tallyOpened: 'Otvorilo',
    tallyResponded: 'Odgovorilo',
    tallyComing: 'Dolazim',
    tallyDelayed: 'Dolazim kasnije',
    tallyDeclined: 'Ne mogu',
    tallyArrived: 'Javilo dolazak',
    tallyPresent: 'Prijavilo prisustvo',
    tallyConfirmed: 'Potvrdjeno prisustvo',

    vehiclesTitle: 'Vozila',
    vehiclesNote:
      'Izlazak vozila je zapis o vozilu. On nikada ne stvara prisustvo clana - to je posebna cinjenica koju clan prijavljuje sam.',
    noVehicles: 'Nijedno vozilo nije evidentirano na ovoj intervenciji',
    vehiclesLabel: 'Vozila i vrijeme van baze',
    colVehicle: 'Vozilo',
    colDeparture: 'Izlazak',
    colReturn: 'Povratak',
    colAway: 'Van baze',
    colDepartureBy: 'Evidentirao izlazak',
    colReturnBy: 'Evidentirao povratak',
    colPurpose: 'Namjena',
    notReturned: 'Jos nije vraceno',
    stillAway: 'Jos je van baze',
    purposeNotRecorded: 'Nije upisana',
  },

  mobilisation: {
    noMemberTitle: 'Vas nalog nije povezan sa clanom drustva.',
    noMemberText: 'Bez toga vas server ne moze staviti na spisak pozvanih.',

    offlineTitle: 'Nema veze sa serverom.',
    refusedRead: 'Server je odbio citanje poziva. Provjerite da li vas nalog jos ima operativni pristup.',
    offlineText: 'Prikazano stanje moze biti zastarjelo, a radnje nece biti sacuvane dok se veza ne vrati.',
    notSaved: 'Nije sacuvano.',

    pickCallOut: 'Poziv',
    noCallOutTitle: 'Nema poziva za vas',
    noCallOutText:
      'Kada vas komandir pozove na intervenciju, pojavice se ovdje. Ovaj spisak pokazuje samo pozive na kojima ste vi na spisku.',

    availabilityTitle: 'Moja opsta dostupnost',
    availabilityNote:
      'Ovo nije odgovor ni na jedan poziv. Govori samo da li ste uopste na raspolaganju ovih dana - komandir to vidi i prije nego sto intervencija postoji.',
    availabilityShow: 'Moja opsta dostupnost',
    availableYes: 'Dostupan sam',
    availableNo: 'Nisam dostupan',
    availableSavedYes: 'Zabiljezeno: dostupni ste.',
    availableSavedNo: 'Zabiljezeno: niste dostupni.',
    availabilityNoteLabel: 'Kratka napomena',
    availabilityNoteHint: 'Na primjer: na godisnjem do 20.09.',
    availabilityUnset: 'Jos se niste izjasnili.',
    availabilityIsYes: 'Dostupni ste',
    availabilityIsNo: 'Niste dostupni',
    availabilitySince: 'od',

    assembly: 'Okupljanje',
    publishedAt: 'objavljeno',
    closedNotice: 'Ova intervencija je zatvorena. Ostaje vidljiva zbog evidencije, ali se vise ne mijenja.',

    step1: '1. Jeste li vidjeli poziv',
    ackDone: 'Otvorili ste ga',
    ackWhy: 'Komandiru je vazno da zna da je poziv uopste stigao do vas - to nije isto sto i odgovor.',
    ackButton: 'Vidio sam poziv',
    ackSaved: 'Zabiljezeno je da ste vidjeli poziv. To jos nije odgovor.',

    step2: '2. Vas odgovor',
    answerChangeable: 'Mozete ga promijeniti ispod.',
    etaQuestion: 'Za koliko stizete?',
    sendAnswer: 'Posalji odgovor',
    answerSaved: 'Odgovor je zabiljezen na serveru.',
    answerIsNotAttendance: 'Odgovor je obecanje, ne evidencija prisustva. Prisustvo se biljezi posebno, nize.',

    step3: '3. Gdje ste sada',
    journeyNote: 'Ovo je samo vasa pozicija za ovaj poziv. Ne prijavljuje prisustvo - ni "Na licu mjesta".',
    journeySavedPrefix: 'Zabiljezeno:',
    journeySavedSuffix: 'Prisustvo time nije prijavljeno.',

    step4: '4. Prisustvo',
    attendanceNote:
      'Prijava biljezi da ste na zadatku od tog trenutka. Zapis nosi oznaku prijavio se sam i ceka potvrdu komandira - do tada se ne racuna kao ucesce.',
    stillRunning: 'jos traje',
    rejectionReason: 'Razlog odbijanja',
    checkIn: 'Prijavi prisustvo',
    checkInSaved: 'Prijava je zabiljezena. Ceka potvrdu komandira da bi se racunala kao ucesce.',
    checkOut: 'Odjavi se',
    checkOutSaved: 'Odjava je zabiljezena. Zapis i dalje ceka potvrdu komandira.',
  },

  archive: {
    loading: 'Ucitavanje arhive...',
    failedTitle: 'Arhiva nije ucitana.',
    refusedRead: 'Server je odbio citanje arhive. Provjerite da li vas nalog jos ima operativni pristup.',
    failedText:
      'Server nije odgovorio, pa ovaj ekran ne prikazuje nikakav zapis - prazna tabela bi ovdje izgledala kao da se nista nije dogodilo.',

    listTitle: 'Zavrsene i objavljene intervencije',
    emptyTitle: 'Arhiva je prazna',
    emptyText: 'Cim komandir objavi prvi poziv, ovdje se pojavljuje njegov zapis.',

    created: 'Kreirano',
    published: 'Objavljeno',
    notPublished: 'nije objavljeno',
    closed: 'Zatvoreno',
    stillRunning: 'jos traje',
    state: 'Stanje',
    closeNote: 'Zabiljeska pri zatvaranju',
    notClosedYet:
      'Ova intervencija jos nije zatvorena, pa zapis nije konacan. Prisustvo se jos moze prijaviti i potvrditi.',

    chronologyTitle: 'Hronologija',
    chronologyNote:
      'Svaki red je jedna cinjenica sa svojim vremenom, onako kako ju je zabiljezio server. Nista nije spojeno u zajednicki status, jer otvaranje poziva, odgovor, kretanje i prisustvo su cetiri razlicite stvari.',
    chronologyDegradedTitle: 'Prikazana je skracena hronologija.',
    chronologyDegradedText:
      'Zabiljezeni redoslijed dogadjaja nije procitan sa servera, pa se ovdje vidi samo posljednje stanje svakog clana - ne i promjene stanja intervencije niti ranije javljeno kretanje. Zapis na serveru je potpun; nedostaje samo ovaj prikaz.',
    chronologyEmptyTitle: 'Nema zabiljezenih dogadjaja',
    chronologyEmptyText: 'Poziv je objavljen, ali jos niko nije otvorio, odgovorio niti se prijavio.',

    timingsTitle: 'Vremena odziva po clanu',
    timingsNote:
      'Svako vrijeme je onako kako ga je upisao server. Trajanja su racunata iz punih vremenskih oznaka, a ne iz prikazanih minuta, i ono sto nije zabiljezeno je oznaceno kao takvo - nikada prikazano kao nula.',

    participationTitle: 'Ucesce na ovoj intervenciji',
    participationNote:
      'Ucesce je samo potvrdjeno i zatvoreno vrijeme. Prijava koju komandir nije potvrdio je i dalje samo izjava i ne ulazi u zbir. Odbijena prijava ostaje u zapisu sa razlogom i ne broji se.',
    participationEmptyTitle: 'Niko nije prijavio prisustvo',
    participationEmptyText: 'Odziv i kretanje se i dalje vide u hronologiji iznad.',
    totalConfirmed: 'Ukupno potvrdjeno',
    stillPendingSuffix: 'prijava jos ceka potvrdu komandira i nije uracunata.',
    perMemberLabel: 'Ucesce po clanu na ovoj intervenciji',
    colConfirmed: 'Potvrdjeno',
    colPending: 'Ceka potvrdu',
    colRejected: 'Odbijeno',
    claimsOne: 'prijava',
    claimsMany: 'prijave',
    noReasonGiven: 'bez upisanog razloga',

    totalsTitle: 'Ukupno ucesce po clanu',
    totalsNote:
      'Zbir svih intervencija, izracunat na serveru. Potvrdjeno, nepotvrdjeno i odbijeno stoje u odvojenim kolonama i nikada se ne sabiraju u jedan broj.',
    totalsEmptyTitle: 'Jos nema zabiljezenog prisustva',
    totalsEmptyText: 'Tabela se popunjava kada se prijavi i potvrdi prvo prisustvo.',
    colConfirmedTime: 'Potvrdjeno vrijeme',
    colConfirmedCount: 'Potvrdjenih',
    colOngoing: 'U toku',
    uncounted: 'neuracunato',

    /**
     * Sentence fragments the chronology builds lines out of.
     *
     * They are fragments, not templates, because both languages put the actor's
     * name first and the verb straight after it - which is the one shape that
     * works in Montenegrin and in English without either reading as a
     * translation.
     */
    saidOpened: 'je otvorio poziv.',
    saidAnswered: 'je odgovorio:',
    saidInMinutes: 'za',
    saidMovement: 'je javio kretanje:',
    saidPresent: 'je prijavljen kao prisutan',
    saidCheckedOut: 'je odjavio prisustvo.',
    saidRejectedFor: 'je odbio prijavu clana',
    saidVehicleOut: 'je izaslo iz baze',
    saidVehicleBack: 'se vratilo u bazu.',
    saidClosed: 'je zatvorio intervenciju',
    saidUnknownEvent: 'je zabiljezio dogadjaj',
    /** Publication writes obligations. It never claims anybody was reached. */
    saidCalledOutMembers: 'za clanova:',
    forMember: 'za clana',
    ofMember: 'clana',
    openAttendanceCount: 'otvorenih prijava prisustva',
    commander: 'Komandir',
  },

  command: {
    tabsLabel: 'Dijelovi komandnog ekrana',
    tabCallOut: 'Poziv',
    tabOverview: 'Pregled',
    tabAttendance: 'Prisustvo',
    tabVehicles: 'Vozila',

    loading: 'Ucitavanje sa servera...',
    refresh: 'Osvjezi sa servera',
    refusedRead: 'Server je odbio citanje. Provjerite da li vas nalog jos ima ulogu.',
    unavailable: 'Server trenutno nije dostupan. Prikaz nije osvjezen.',
    notSaved: 'Promjena nije sacuvana.',
    pickIntervention: 'Intervencija',

    newTitle: 'Nova priprema poziva',
    newSummary: 'Pripremi novi poziv',
    newNote: 'Nacrt vidi samo komanda. Niko nije pozvan dok ne pritisnete Objavi.',
    fieldKind: 'Vrsta',
    fieldOtherKind: 'Kratak opis vrste',
    fieldTitle: 'Naslov',
    fieldTitleHint: 'Kratko, da se vidi na zakljucanom ekranu.',
    fieldLocation: 'Lokacija',
    fieldLocationHint: 'Upisana adresa ili opis mjesta. Sama koordinata nije dovoljna u tri ujutru.',
    fieldAssembly: 'Mjesto okupljanja',
    fieldInstructions: 'Uputstvo ekipi',
    saving: 'Cuvanje...',
    saveDraft: 'Sacuvaj nacrt',
    draftSaved: 'Priprema poziva je sacuvana kao nacrt. Jos nije objavljena.',

    /** The four steps of writing a call-out, in the order they are asked. */
    stepDetails: 'Sta se desilo',
    stepWhere: 'Gdje i sta raditi',
    stepWho: 'Kome',
    stepReview: 'Provjera',
    wizardNext: 'Dalje',
    wizardBack: 'Nazad',
    wizardToReview: 'Dalje na provjeru',
    reviewTitle: 'Provjerite prije slanja',
    reviewRecipients: 'clanova dobija ovaj poziv',
    draftIsNotSent: 'Cuvanje nacrta nikoga ne zove. Poziv se salje tek na koraku Provjera.',
    draftRestored: 'Vraceno je sto ste ranije zapoceli na ovom uredjaju. Nije poslato nikome.',

    recipientsTitle: 'Kome se salje',
    recipientsNote:
      'Spisak daje server: prikazani su samo clanovi koji zaista mogu da prime i otvore poziv - aktivan clan, aktivan nalog i popunjen profil. Clan kome je nalog ukinut se ne prikazuje i ne moze biti pozvan. Oznaka dostupnosti je opsta izjava clana, a ne odgovor na ovaj poziv.',
    recipientsUnreadTitle: 'Spisak clanova nije procitan sa servera.',
    recipientsUnreadText:
      'Ovo nije podatak da nema clanova - znaci da odgovor nije stigao. Osvjezite prikaz prije nego sto objavite poziv.',
    recipientsNoneTitle: 'Nijedan clan trenutno ne moze da primi poziv.',
    recipientsNoneText:
      'Poziv se moze poslati samo clanu sa aktivnim nalogom i popunjenim profilom. Clan kome je nalog ukinut se ovdje ne prikazuje.',
    recipientsListLabel: 'Spisak clanova za poziv',
    availableYes: 'Dostupan',
    availableNo: 'Nije dostupan',
    availableUnknown: 'Nije izjasnjen',
    selectedCount: 'Izabrano',

    publish: 'Objavi poziv',
    discardDraft: 'Odbaci nacrt',
    draftDiscarded: 'Nacrt je odbacen i ostaje zabiljezen kao otkazan.',

    statusTitle: 'Stanje intervencije',
    statusChanged: 'Stanje je promijenjeno u',
    closeIntervention: 'Zatvori intervenciju',
    closedWithNote: 'Zatvoreno',
    closedMessage: 'Intervencija je zatvorena.',
    cancelledMessage: 'Intervencija je otkazana.',
    noInterventionTitle: 'Nema nijedne intervencije',
    noInterventionText: 'Napravite prvi nacrt ispod. Dok ne objavite, niko ga ne vidi.',

    confirmPublishTitle: 'Objaviti poziv?',
    confirmPublishAction: 'Objavi',
    confirmPublishToPrefix: 'Poziv ide na',
    confirmPublishToSuffix: 'clanova. Spisak se zamrzava u trenutku objave.',
    confirmPublishTransport:
      'Clanovi koji su ukljucili Web Push mogu dobiti operativno upozorenje. Ostalima poziv ostaje vidljiv u aplikaciji. Prihvatanje od push servisa nije dokaz da je telefon zazvonio niti da je clan otvorio poziv. Nema SMS, Viber ni automatskog telefonskog poziva.',
    publishedWorkerReached:
      'Poziv je objavljen. Server je primio zahtjev za push obradu; pregled isporuke pokazuje sta je provajder prihvatio, a otvaranje poziva ostaje zasebna cinjenica.',
    publishedWorkerQueued:
      'Poziv je objavljen. Push poruke su ostale u redu za serversku obradu; ovo nije potvrda da je telefon zazvonio.',

    confirmCloseTitle: 'Zatvoriti intervenciju?',
    confirmCloseAction: 'Zatvori',
    confirmDiscardTitle: 'Odbaciti nacrt?',
    confirmDiscardAction: 'Odbaci',
    fieldReason: 'Razlog',
    reasonStaysHint: 'Ostaje trajno na zapisu.',
    openIntervalsPrefix: 'Jos',
    openIntervalsSuffix:
      'clanova je prijavljeno i nije se odjavilo. Ostaju otvoreni na zapisu - vrijeme im se nece izmisliti.',

    pickInterventionTitle: 'Izaberite intervenciju',
    overviewNeedsOne: 'Pregled prikazuje stanje jedne intervencije.',
    draftNotPublishedTitle: 'Nacrt jos nije objavljen',
    draftNotPublishedText: 'Niko nije pozvan, pa nema odziva za prikaz.',

    nowOnScene: 'Sada na terenu',
    nowOnSceneNote: 'Stanje u ovom trenutku. Sve kumulativne brojke i vremena su nize, u pregledu odziva.',
    countOnTask: 'Trenutno na zadatku',
    countVehiclesOut: 'Vozila na terenu',
    auditMissing:
      'Hronologija nije procitana sa servera, pa pojedina vremena kretanja i imena koja su mijenjala stanje nisu prikazana.',

    whoIsWhere: 'Ko je gdje',
    whoIsWhereLabel: 'Pregled odziva po clanu',
    colOpened: 'Otvorio',
    chipOpened: 'Otvorio',
    chipNotOpened: 'Nije otvorio',
    chipNoMovement: 'Nije javio',
    chipCheckedIn: 'Prijavljen',
    chipConfirmed: 'Potvrdjeno',
    chipAwaiting: 'Ceka potvrdu',
    chipNoRecord: 'Nema zapisa',
    timingsNote:
      'Svako vrijeme dolazi sa servera. Trajanja su racunata iz punih vremenskih oznaka, ne iz prikazanih minuta, a ono sto nije zabiljezeno je oznaceno kao takvo.',

    attendanceNeedsOne: 'Prisustvo se vodi po intervenciji.',
    officialTitle: 'Zvanicno vrijeme ucesca',
    officialNote:
      'Racuna se samo potvrdjeno i zatvoreno prisustvo. Zapis koji ceka potvrdu ili je odbijen ne ulazi u ovu brojku - ni djelimicno.',
    openRecordsPrefix: 'Jos',
    openRecordsSuffix:
      'zapisa je otvoreno. Otvoren zapis nema trajanje dok se clan ne odjavi, pa se ne racuna.',

    pendingTitle: 'Ceka potvrdu',
    pendingEmpty: 'Nema zapisa koji cekaju',
    pickAll: 'Izaberi sve',
    pickNone: 'Ponisti izbor',
    confirmPicked: 'Potvrdi izabrano',
    confirmNoteRule:
      'Potvrda ne trazi napomenu: trideset istih recenica ne bi bile zapis nego smece. Odbijanje i povlacenje potvrde traze razlog, jer mijenjaju ono sto je clan rekao o sebi.',
    stillCheckedIn: 'jos je prijavljen',
    confirmedMany: 'Potvrdjeno zapisa',
    confirmedSome: 'Potvrdjeno',
    notConfirmedSome: 'nije potvrdjeno',
    confirmOne: 'Potvrdi',
    confirmedOneMessage: 'Prisustvo je potvrdjeno.',
    reject: 'Odbij',
    correctTime: 'Ispravi vrijeme',

    confirmedTitle: 'Potvrdjeno',
    confirmedEmpty: 'Jos nista nije potvrdjeno',
    unconfirm: 'Povuci potvrdu',

    rejectedTitle: 'Odbijeno',
    rejectedNote:
      'Odbijen zapis ostaje na evidenciji sa razlogom. Ne brise se - brisanje bi sakrilo da je neko tvrdio da je bio tu.',
    reasonLabel: 'Razlog',

    recordForMemberTitle: 'Upisi prisustvo za clana',
    recordForMemberNote:
      'Zapis koji komanda upise nosi oznaku Upisala komanda i i dalje ceka potvrdu. "Zapisao sam" i "stojim iza toga" nisu ista tvrdnja.',
    checkOutMember: 'Odjavi',
    checkInMember: 'Prijavi',
    checkOutRecorded: 'odjava je zabiljezena.',
    checkInRecorded: 'prijava je zabiljezena i ceka potvrdu.',

    confirmRejectTitle: 'Odbiti zapis prisustva?',
    confirmUnconfirmTitle: 'Povuci potvrdu?',
    confirmCorrectTitle: 'Ispraviti vrijeme?',
    reasonPermanentHint: 'Trajno ostaje uz zapis, sa vasim imenom i vremenom.',
    signedBy: 'Odluku potpisuje',
    rejectedMessage: 'Zapis je odbijen i ostaje vidljiv sa razlogom.',
    unconfirmedMessage: 'Potvrda je povucena. Zapis je ponovo u cekanju.',
    correctedMessage: 'Ispravka je zabiljezena sa razlogom.',

    vehiclesNote: 'Izlazak vozila je svoja cinjenica. Ne prijavljuje nicije prisustvo i ne mijenja nicij odgovor.',
    vehiclesEmptyTitle: 'Nema unesenih vozila',
    vehiclesEmptyText: 'Vozila se unose na ekranu Evidencija.',
    vehicleOutOfService: 'Van upotrebe',
    vehicleOnScene: 'Na terenu',
    vehicleAtStation: 'U bazi',
    vehicleDeparted: 'Izaslo',
    recordDeparture: 'Zabiljezi izlazak',
    recordReturn: 'Zabiljezi povratak',
    departureRecorded: 'izlazak je zabiljezen.',
    returnRecorded: 'povratak je zabiljezen.',
  },

  callout: {
    /**
     * The eyebrow over the action card, in every state.
     *
     * Three of the six steps are a single button and carried no heading at all,
     * so the card read as a loose paragraph with a button under it - the same
     * weight as the cards below. This one word says what the card is: the next
     * thing, and the only thing being asked for right now.
     */
    nextLabel: 'Sljedece',
    /** Replaces it once nothing is being asked. */
    nothingLabel: 'Nista dalje',

    /** The one dominant action, named for the state it belongs to. */
    doAcknowledge: 'Vidio sam poziv',
    doAcknowledgeWhy: 'Javite komandiru da je poziv stigao do vas.',
    doAnswer: 'Dolazite li?',
    doAnswerWhy: 'Komandir ceka vas odgovor.',
    doMove: 'Javite gdje ste',
    doMoveWhy: 'Ne prijavljuje prisustvo - ni "Na licu mjesta".',
    doCheckIn: 'Prijavi prisustvo',
    doCheckInWhy: 'Komandir potvrdjuje prijavu; do tada se ne racuna kao ucesce.',
    doCheckOut: 'Odjavi se',
    doCheckOutWhy: 'Prijavljeni ste na zadatku od ranije.',
    doneTitle: 'Nema vise koraka za vas',
    doneClosed: 'Intervencija je zatvorena. Zapis ostaje vidljiv.',
    doneDeclined: 'Javili ste da ne mozete doci.',
    doneTurnedBack: 'Javili ste da odustajete.',

    /** The compact strip: four facts, each said in one or two words. */
    factAcknowledged: 'Vidjeli',
    factAnswered: 'Odgovorili',
    factMoving: 'Krenuli',
    factAttending: 'Prisustvo',
    factDone: 'da',
    factPending: 'ne',
    /** A closed record nobody has confirmed. Not "ne" and not "da". */
    attendancePending: 'Ceka potvrdu',
    attendanceConfirmed: 'Potvrdjeno',
    myStatus: 'Sta ste javili',

    etaQuestion: 'Za koliko stizete?',
    changeAnswer: 'Promijeni odgovor',
    moreActions: 'Ostale radnje',
    attendanceRecord: 'Moje prijave prisustva',
    closedNotice: 'Ova intervencija je zatvorena i vise se ne mijenja.',
  },

  responseBar: {
    title: 'Odziv',
    invited: 'Pozvano',
    coming: 'Dolaze',
    later: 'Kasne',
    declined: 'Ne mogu',
    noAnswer: 'Bez odgovora',
    onScene: 'Na terenu',
    seeAll: 'Ko je gdje',
  },

  common: {
    cancel: 'Odustani',
    close: 'Zatvori',
    confirm: 'Potvrdi',
    save: 'Sacuvaj',
    back: 'Nazad',
    details: 'Detalji',
    showMore: 'Prikazi vise',
    showLess: 'Prikazi manje',
    loading: 'Ucitavanje...',
    none: 'Nema',
    total: 'Ukupno',
    time: 'Vrijeme',
    status: 'Status',
    member: 'Clan',
    moreInfo: 'Dodatne informacije',
    required: 'obavezno',
    optional: 'nije obavezno',
    yes: 'Da',
    no: 'Ne',
  },

  /**
   * Server-side vocabulary: the words for values the DATABASE stores.
   *
   * Kept apart from the simulation's vocabulary in `labels.ts` on purpose. The
   * two look similar and mean different things, and one screen showing the
   * other's words is exactly how a demonstration starts implying a server is
   * involved when it is not.
   */
  vocabulary: {
    interventionKind: {
      POZAR: 'Pozar',
      SAOBRACAJNA_NEZGODA: 'Saobracajna nezgoda',
      TEHNICKA_POMOC: 'Tehnicka pomoc',
      VJEZBA: 'Vjezba',
      TEST: 'Test',
      DRUGO: 'Drugo',
    } as Record<string, string>,

    interventionStatus: {
      DRAFT: 'Nacrt',
      PUBLISHED: 'Objavljeno',
      ASSEMBLING: 'Okupljanje',
      DEPLOYED: 'Na terenu',
      CONTAINED: 'Pod kontrolom',
      CLOSED: 'Zatvoreno',
      CANCELLED: 'Otkazano',
    } as Record<string, string>,

    answer: {
      DOLAZIM: 'Dolazim',
      DOLAZIM_KASNIJE: 'Dolazim kasnije',
      NE_MOGU: 'Ne mogu',
    } as Record<string, string>,

    /** Where a member is for one call-out. Never a statement about attendance. */
    journey: {
      KRECEM: 'Krecem',
      U_PUTU: 'U putu',
      NA_LICU_MJESTA: 'Na licu mjesta',
      ODUSTAJEM: 'Odustajem',
    } as Record<string, string>,

    /** Who asserted an interval. Separate from whether command confirmed it. */
    attendanceSource: {
      SELF_DECLARED: 'Prijavio se sam',
      COMMAND_RECORDED: 'Upisala komanda',
      UNKNOWN: 'Nepoznato porijeklo',
    } as Record<string, string>,

    attendanceState: {
      PENDING: 'Ceka potvrdu',
      CONFIRMED: 'Potvrdjeno',
      REJECTED: 'Odbijeno',
    } as Record<string, string>,

    role: {
      OWNER: 'Vlasnik',
      ADMIN: 'Administrator',
      COMMANDER: 'Komandir',
      FIREFIGHTER: 'Vatrogasac',
      CITIZEN: 'Bez operativnih prava',
    } as Record<string, string>,

    noAnswer: 'Bez odgovora',
    unnamedActor: 'Nepoznat nalog',

    /**
     * One sentence per event type in `operational_audit`, written as a member
     * would say it rather than as a field name - the archive is read by people
     * who were at the incident, not by anybody debugging it.
     *
     * The distinctions the rest of the system keeps apart are kept apart here.
     * Reporting movement is never described as attendance; publishing is never
     * described as notifying, because publishing sends nothing; a confirmation
     * is always named as the commander's act, not the member's.
     */
    auditEvent: {
      INTERVENTION_DRAFTED: 'je pripremio nacrt poziva',
      INTERVENTION_DRAFT_UPDATED: 'je izmijenio nacrt prije objave',
      INTERVENTION_DRAFT_DISCARDED: 'je odbacio nacrt',
      INTERVENTION_PUBLISHED: 'je objavio poziv',
      INTERVENTION_STATUS_CHANGED: 'je promijenio stanje intervencije',
      INTERVENTION_CLOSED: 'je zatvorio intervenciju',
      INTERVENTION_CANCELLED: 'je otkazao intervenciju',
      JOURNEY_PROGRESS_SET: 'je javio kretanje',
      ATTENDANCE_CHECK_IN: 'je zabiljezio dolazak',
      ATTENDANCE_CHECK_OUT: 'je zabiljezio odlazak',
      ATTENDANCE_CONFIRMED: 'je potvrdio prijavu prisustva',
      ATTENDANCE_UNCONFIRMED: 'je povukao potvrdu prisustva',
      ATTENDANCE_REJECTED: 'je odbio prijavu prisustva',
      ATTENDANCE_CORRECTED: 'je ispravio zapis o prisustvu',
      VEHICLE_DEPARTED: 'je evidentirao izlazak vozila',
      VEHICLE_RETURNED: 'je evidentirao povratak vozila',
    } as Record<string, string>,
  },
};

/**
 * The shape every language must fill.
 *
 * Deliberately NOT `as const`: literal types would make `en` fail to be a
 * `Strings` simply because "Work" is not "Rad", which is the opposite of the
 * check that is wanted. Widened to `string`, the type instead demands that
 * every key exists - which is exactly the thing a translator forgets.
 */
export type Strings = typeof me;
