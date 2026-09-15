/**
 * English.
 *
 * Typed `Strings`, which is `typeof me`. A sentence added to the Montenegrin
 * bundle and not translated here does not compile, which is how this file stays
 * complete without anybody having to remember to check.
 *
 * Two rules carried over from the review of the original wording, because they
 * are the ones a translation is most likely to quietly break:
 *
 * - NOTHING claims delivery. Push is accepted by a service; a phone ringing is
 *   a different fact, and no sentence here may blur the two.
 * - A ROLE MEANS WHAT THE SERVER MEANS BY IT. "Komandir" is the role that may
 *   publish a call-out, and "Commander" has to be the same role, not a
 *   friendlier-sounding one.
 */

import type { Strings } from './strings.me';

export const en: Strings = {
  app: {
    name: 'DVD Tivat',
    subtitle: 'Operational prototype',
    mark: 'D',
  },

  nav: {
    groupWork: 'Work',
    groupSociety: 'Society',
    main: 'Main navigation',
    workspace: 'DVD Tivat workspace',
    skipToContent: 'Skip to content',
  },

  routes: {
    poziv: { name: 'Call-out', description: 'Prepare, publish and lead a real intervention' },
    mobilizacija: { name: 'My call-out', description: 'Your availability, your call-out and your attendance' },
    arhiva: { name: 'Archive', description: 'The record of closed interventions and confirmed attendance' },
    evidencija: { name: 'Records', description: 'The society’s real members, groups and vehicles on the server' },
    nalozi: { name: 'Accounts', description: 'Real accounts on the server: sign-in, roles and withdrawal of access' },
    podesavanja: { name: 'Settings', description: 'Language and notifications on this device' },
    prikaz: { name: 'Station display', description: 'Simulation: a status view intended for a screen at the station' },
    dojava: {
      name: 'Public report',
      description: 'Abandoned research prototype. Not a channel for reporting emergencies',
    },
    dezurni: { name: 'Duty officer', description: 'Simulation: preparing a call-out and following the crew’s answers' },
    clan: { name: 'Member', description: 'Simulation: a call-out and an answer from one member’s point of view' },
    vozila: { name: 'Vehicles', description: 'Simulation: recording a vehicle leaving and returning by hand' },
    clanovi: { name: 'Members', description: 'Simulation: members, roles, groups and qualifications' },
    istorija: { name: 'History', description: 'Simulation: finished exercises and a chronology of changes' },
  },

  shell: {
    identityLoading: 'Checking access...',
    identityNotConfigured: 'Local prototype',
    identityNotSignedIn: 'Not signed in',
    identityServerUnreachable: 'Server unreachable',
    identityNoRole: 'No role',
    identitySuspended: 'Access withdrawn',
    loadingView: 'Loading view...',

    serverBadge: 'REAL DATA',
    serverBadgeText:
      'This screen runs on the server. Sign-in, role and access are checked on every request.',
    simulationBadge: 'SIMULATION',
    simulationBadgeText:
      'Invented data in this browser. No push, SMS or telephone calls, and no access checks.',
    simulationNotice:
      'This screen still runs on the local simulation: the data is invented, it is kept only in this browser, and who you are is chosen with the simulated participant selector. No server is involved and nothing here checks any rights.',
    simulationBackToWork: 'The real work is in the Work group.',
    simulatedActor: 'Simulated participant',
    simulatedActorHint: 'A demonstration. This is not a sign-in and grants no rights.',

    footerServer: 'This screen runs on the server; who you are is decided by signing in, not by a selector.',
    footerServerData:
      'The data on this screen is read from and written to the server, with access checked on every request. Only invented members and invented data are used for demonstration.',
    footerLocalData:
      'The data is kept only in this browser, on this device. Nothing is synchronised between devices and nothing is sent to a server. Clearing the browser’s data clears this too.',
  },

  settings: {
    title: 'Settings',
    lead: 'These apply to this device and this browser only. Nothing here is sent to the server.',

    languageTitle: 'Language',
    languageHint: 'Changes the language of the interface. It does not change what members have written.',
    languageLegend: 'Choose a language',
    languageSaved: 'The language has been saved on this device.',
    languageNotSaved:
      'The language has changed, but this browser cannot remember it. Reloading will return to Crnogorski.',
    contentNotTranslated:
      'Intervention titles, member names, instructions and notes are shown exactly as they were written, in the language they were written in.',

    notificationsTitle: 'Notifications on this device',
    displayTitle: 'Time and display',
    displayZone: 'All times are shown in Montenegro’s time, whatever this device is set to.',
    displayZoneMissing:
      'This browser has no time zone data, so times cannot be shown reliably.',

    prototypeTitle: 'Prototype and simulation',
    prototypeSummary: 'Show the simulation screens',
    prototypeWarning:
      'These screens are the old simulation. The data is invented, it is kept only in this browser, and it has nothing to do with real call-outs. Do not use them during a real intervention.',

    aboutTitle: 'About',
    aboutFallback:
      'This is not a replacement for calling the official fire service. In a fire or an accident, call the emergency telephone number immediately.',
    aboutStorage: 'This device’s settings',
    aboutStorageValue: 'Kept locally, in this browser',
  },

  gate: {
    loadingAccess: 'Checking access...',
    loadingOperational: 'Loading operational data...',
    retry: 'Try again',
    recheck: 'Check again',
    recheckAccess: 'Check access again',
    goToSignIn: 'Go to sign-in',
    completeProfile: 'Complete profile',

    wrongRoleTitle: 'This screen is not for your role.',
    wrongRoleSignedInAs: 'You are signed in as',
    wrongRoleUsedBy: 'This screen is used by:',
    wrongRoleServerWouldRefuse: 'The server would refuse any action from here in any case.',

    notConfiguredTitle: 'This copy is not connected to a server.',
    notConfiguredText:
      'The operational screens work only when the project connection details are configured. The prototype still runs locally.',

    signInRequiredTitle: 'Sign in to see this screen.',
    signInRequiredText: 'Operational data is read from the server only once the server confirms who you are.',

    serverUnreachableTitle: 'The server is unreachable.',
    serverUnreachableText:
      'Nothing is shown in place of the real state, because stale data during an intervention is worse than an empty screen.',

    dataUnavailableTitle: 'The server is not available at the moment.',
    dataUnavailableText: 'The data was not loaded, so this screen is not showing the state.',

    accountBrokenTitle: 'The account is incomplete.',
    accountBrokenText: 'The server has no profile for you. Contact the account owner - this cannot be fixed from the application.',

    profileRequiredTitle: 'Complete your profile.',
    profileRequiredText: 'Enter your first and last name so the server can recognise you as a member.',

    suspendedTitle: 'Your access has been withdrawn.',
    suspendedText:
      'The operational screens are closed and the server refuses every action. The reason and the time are recorded; contact the account owner.',

    awaitingApprovalTitle: 'The account is awaiting approval.',
    awaitingApprovalText: 'The owner assigns a role, and only then do the operational screens open.',

    noMemberTitle: 'Your account is not linked to a member of the society.',
    noMemberText:
      'Because of that you cannot be put on a call-out list and you cannot state your attendance. An administrator links it on the Records screen.',
    noMemberUntilThen: 'Until then this screen has nothing to show for you.',
  },

  push: {
    eyebrow: 'OPERATIONAL ALERT',
    title: 'Notifications for a new call-out',
    stateOn: 'On',
    stateOff: 'Off',
    stateChecking: 'Checking...',

    enable: 'Turn on operational notifications',
    disable: 'Turn off on this device',
    openSettings: 'Settings',

    installOnIos: 'On an iPhone, first choose Share - Add to Home Screen, open DVD Tivat from that icon, then turn notifications on here.',
    unsupported: 'This browser does not support reliable Web Push notifications.',
    notConfigured: 'The push service is not yet connected to this published version.',
    denied: 'Notifications are refused in the phone’s settings. Allow them for DVD Tivat, then open the application again.',
    failed: 'The notification was not set up. Check the connection and try again.',

    enabledExplanation:
      'This device is registered for an operational call-out. The system will try to show an alert even when the application is not open. Sound and vibration depend on the phone’s settings and may not happen.',
    privacyExplanation:
      'The alert reveals neither the location nor any details on a locked screen. Opening the notification leads into the signed-in application and the specific call-out.',
    fallbackReminder:
      'Push is an additional way of being told and is not a replacement for a telephone call or Viber. For a real alarm the agreed telephone call still applies.',
  },

  timings: {
    nobodyInvited: 'Nobody was called out to this intervention',
    perMemberLabel: 'Response times by member',
    colMember: 'Member',
    colOpened: 'Opened',
    colAnswer: 'Answer',
    colMovement: 'Movement',
    colArrival: 'Arrival',
    colAttendance: 'Attendance',

    factTime: 'Time',
    factSincePublication: 'After publication',
    factSinceOpening: 'After opening',
    factEstimate: 'Stated estimate',
    factReported: 'Reported',
    factOnScene: 'On scene',
    factCheckIn: 'Checked in',
    factCheckOut: 'Checked out',
    factStillCheckedIn: 'Still checked in',
    factConfirmed: 'Confirmed',
    factAwaitingConfirmation: 'Awaiting confirmation',
    factRejected: 'Rejected',
    minutesShort: 'min',

    societyTitle: 'The society’s response times',
    societyNote:
      'Every time is measured from the publication of the call-out, from times written by the server. The first event is chosen by time, never by its position in a list.',
    firstOpen: 'First opening of the call-out',
    firstAnswer: 'First answer',
    firstComing: 'First answer of Coming',
    firstArrive: 'First arrival on scene',
    firstCheckIn: 'First stated attendance',
    firstVehicle: 'First vehicle out',

    durationTitle: 'Duration of the intervention',
    published: 'Published',
    closed: 'Closed',
    stillRunning: 'Still running',
    totalDuration: 'Total duration',
    totalConfirmed: 'Total confirmed participation',
    statePeriodsLabel: 'Time spent in each state',
    colState: 'State',
    colFrom: 'From',
    colTo: 'To',
    colDuration: 'Duration',
    colChangedBy: 'Changed by',
    byPublication: 'By publishing the call-out',

    countsTitle: 'The response in numbers',
    countsNote:
      'Every number is its own fact. Who opened the call-out is not who answered, who answered is not who arrived, and stated attendance is not confirmed attendance.',
    tallyInvited: 'Called out',
    tallyOpened: 'Opened',
    tallyResponded: 'Answered',
    tallyComing: 'Coming',
    tallyDelayed: 'Coming later',
    tallyDeclined: 'Cannot come',
    tallyArrived: 'Reported arrival',
    tallyPresent: 'Stated attendance',
    tallyConfirmed: 'Confirmed attendance',

    vehiclesTitle: 'Vehicles',
    vehiclesNote:
      'A vehicle leaving is a record about the vehicle. It never creates attendance for a member - that is a separate fact the member states themselves.',
    noVehicles: 'No vehicle was recorded on this intervention',
    vehiclesLabel: 'Vehicles and time away from the station',
    colVehicle: 'Vehicle',
    colDeparture: 'Departed',
    colReturn: 'Returned',
    colAway: 'Away',
    colDepartureBy: 'Departure recorded by',
    colReturnBy: 'Return recorded by',
    colPurpose: 'Purpose',
    notReturned: 'Not returned yet',
    stillAway: 'Still away',
    purposeNotRecorded: 'Not entered',
  },

  mobilisation: {
    noMemberTitle: 'Your account is not linked to a member of the society.',
    noMemberText: 'Without that the server cannot put you on a call-out list.',

    offlineTitle: 'No connection to the server.',
    offlineText: 'What is shown may be out of date, and actions will not be saved until the connection returns.',
    notSaved: 'Not saved.',

    pickCallOut: 'Call-out',
    noCallOutTitle: 'There is no call-out for you',
    noCallOutText:
      'When your commander calls you out to an intervention it will appear here. This list shows only the call-outs you are on.',

    availabilityTitle: 'My general availability',
    availabilityNote:
      'This is not an answer to any call-out. It says only whether you are available at all these days - the commander sees it before an intervention even exists.',
    availabilityShow: 'My general availability',
    availableYes: 'I am available',
    availableNo: 'I am not available',
    availableSavedYes: 'Recorded: you are available.',
    availableSavedNo: 'Recorded: you are not available.',
    availabilityNoteLabel: 'Short note',
    availabilityNoteHint: 'For example: on leave until 20.09.',
    availabilityUnset: 'You have not said yet.',
    availabilityIsYes: 'You are available',
    availabilityIsNo: 'You are not available',
    availabilitySince: 'since',

    assembly: 'Assembly point',
    publishedAt: 'published',
    closedNotice: 'This intervention is closed. It stays visible as a record, but it no longer changes.',

    step1: '1. Have you seen the call-out',
    ackDone: 'You opened it at',
    ackWhy: 'The commander needs to know the call-out reached you at all - which is not the same as an answer.',
    ackButton: 'I have seen the call-out',
    ackSaved: 'It is recorded that you have seen the call-out. That is not yet an answer.',

    step2: '2. Your answer',
    answerChangeable: 'You can change it below.',
    etaQuestion: 'How long until you arrive?',
    sendAnswer: 'Send answer',
    answerSaved: 'The answer is recorded on the server.',
    answerIsNotAttendance: 'An answer is a promise, not a record of attendance. Attendance is recorded separately, below.',

    step3: '3. Where you are now',
    journeyNote: 'This is only your position for this call-out. It does not state attendance - not even "On scene".',
    journeySavedPrefix: 'Recorded:',
    journeySavedSuffix: 'This does not state attendance.',

    step4: '4. Attendance',
    attendanceNote:
      'Checking in records that you are on the task from that moment. The record is marked as stated by the member and awaits the commander’s confirmation - until then it does not count as participation.',
    stillRunning: 'still running',
    rejectionReason: 'Reason for rejection',
    checkIn: 'State my attendance',
    checkInSaved: 'Your check-in is recorded. It awaits the commander’s confirmation before it counts as participation.',
    checkOut: 'Check out',
    checkOutSaved: 'Your check-out is recorded. The record still awaits the commander’s confirmation.',
  },

  archive: {
    loading: 'Loading the archive...',
    failedTitle: 'The archive was not loaded.',
    failedText:
      'The server did not answer, so this screen shows no record at all - an empty table here would look as though nothing had happened.',

    listTitle: 'Closed and published interventions',
    emptyTitle: 'The archive is empty',
    emptyText: 'As soon as a commander publishes the first call-out, its record appears here.',

    created: 'Created',
    published: 'Published',
    notPublished: 'not published',
    closed: 'Closed',
    stillRunning: 'still running',
    state: 'State',
    closeNote: 'Note on closing',
    notClosedYet:
      'This intervention is not closed yet, so the record is not final. Attendance can still be stated and confirmed.',

    chronologyTitle: 'Chronology',
    chronologyNote:
      'Every line is one fact with its own time, exactly as the server recorded it. Nothing is merged into a shared status, because opening a call-out, answering, movement and attendance are four different things.',
    chronologyDegradedTitle: 'A shortened chronology is being shown.',
    chronologyDegradedText:
      'The recorded order of events was not read from the server, so only each member’s latest state is visible here - not the changes of the intervention’s state and not movement reported earlier. The record on the server is complete; only this view is missing part of it.',
    chronologyEmptyTitle: 'No recorded events',
    chronologyEmptyText: 'The call-out was published, but nobody has opened it, answered or checked in yet.',

    timingsTitle: 'Response times by member',
    timingsNote:
      'Every time is as the server wrote it. Durations are calculated from full timestamps rather than from the minutes on screen, and anything unrecorded is marked as such - never shown as a zero.',

    participationTitle: 'Participation in this intervention',
    participationNote:
      'Participation is confirmed, closed time only. A check-in the commander has not confirmed is still only a statement and does not enter the total. A rejected check-in stays in the record with its reason and counts for nothing.',
    participationEmptyTitle: 'Nobody stated any attendance',
    participationEmptyText: 'Answers and movement are still visible in the chronology above.',
    totalConfirmed: 'Total confirmed',
    stillPendingSuffix: 'check-ins are still awaiting the commander’s confirmation and are not counted.',
    perMemberLabel: 'Participation by member in this intervention',
    colConfirmed: 'Confirmed',
    colPending: 'Awaiting confirmation',
    colRejected: 'Rejected',
    claimsOne: 'check-in',
    claimsMany: 'check-ins',
    noReasonGiven: 'no reason entered',

    totalsTitle: 'Total participation by member',
    totalsNote:
      'The sum of every intervention, calculated on the server. Confirmed, unconfirmed and rejected stand in separate columns and are never added into a single number.',
    totalsEmptyTitle: 'No attendance recorded yet',
    totalsEmptyText: 'The table fills in once the first attendance is stated and confirmed.',
    colConfirmedTime: 'Confirmed time',
    colConfirmedCount: 'Confirmed',
    colOngoing: 'Ongoing',
    uncounted: 'not counted',

    saidOpened: 'opened the call-out.',
    saidAnswered: 'answered:',
    saidInMinutes: 'in',
    saidMovement: 'reported movement:',
    saidPresent: 'was recorded as present',
    saidCheckedOut: 'checked out.',
    saidRejectedFor: 'rejected the stated attendance of',
    saidVehicleOut: 'left the station',
    saidVehicleBack: 'returned to the station.',
    saidClosed: 'closed the intervention',
    saidUnknownEvent: 'recorded an event',
    saidCalledOutMembers: 'to this many members:',
    forMember: 'for',
    ofMember: 'of',
    openAttendanceCount: 'open check-ins',
    commander: 'Commander',
  },

  command: {
    tabsLabel: 'Parts of the command screen',
    tabCallOut: 'Call-out',
    tabOverview: 'Overview',
    tabAttendance: 'Attendance',
    tabVehicles: 'Vehicles',

    loading: 'Loading from the server...',
    refresh: 'Refresh from the server',
    refusedRead: 'The server refused the read. Check whether your account still has a role.',
    unavailable: 'The server is not available at the moment. The view was not refreshed.',
    notSaved: 'The change was not saved.',
    pickIntervention: 'Intervention',

    newTitle: 'New call-out',
    newSummary: 'Prepare a new call-out',
    newNote: 'Only command sees a draft. Nobody is called out until you press Publish.',
    fieldKind: 'Kind',
    fieldOtherKind: 'Short description of the kind',
    fieldTitle: 'Title',
    fieldTitleHint: 'Short, so it can be read on a locked screen.',
    fieldLocation: 'Location',
    fieldLocationHint: 'A written address or a description of the place. A coordinate alone is not enough at three in the morning.',
    fieldAssembly: 'Assembly point',
    fieldInstructions: 'Instructions for the crew',
    saving: 'Saving...',
    saveDraft: 'Save draft',
    draftSaved: 'The call-out is saved as a draft. It has not been published.',

    factKind: 'Kind',
    factLocation: 'Location',
    factAssembly: 'Assembly point',
    factInstructions: 'Instructions',
    notStated: 'Not stated',

    recipientsTitle: 'Who it goes to',
    recipientsNote:
      'The list comes from the server: only members who can genuinely receive and open a call-out are shown - an active member, an active account and a completed profile. A member whose account has been withdrawn is not shown and cannot be called out. The availability mark is the member’s general statement, not an answer to this call-out.',
    recipientsUnreadTitle: 'The list of members was not read from the server.',
    recipientsUnreadText:
      'This is not evidence that there are no members - it means no answer arrived. Refresh the view before publishing the call-out.',
    recipientsNoneTitle: 'No member can currently receive a call-out.',
    recipientsNoneText:
      'A call-out can only go to a member with an active account and a completed profile. A member whose account has been withdrawn is not shown here.',
    recipientsListLabel: 'List of members to call out',
    availableYes: 'Available',
    availableNo: 'Not available',
    availableUnknown: 'Has not said',
    selectedCount: 'Selected',

    publish: 'Publish the call-out',
    discardDraft: 'Discard draft',
    draftDiscarded: 'The draft is discarded and stays recorded as cancelled.',

    statusTitle: 'State of the intervention',
    statusChanged: 'The state was changed to',
    closeIntervention: 'Close the intervention',
    closedWithNote: 'Closed',
    closedMessage: 'The intervention is closed.',
    cancelledMessage: 'The intervention is cancelled.',
    noInterventionTitle: 'There is no intervention',
    noInterventionText: 'Make the first draft below. Until you publish it, nobody sees it.',

    confirmPublishTitle: 'Publish the call-out?',
    confirmPublishAction: 'Publish',
    confirmPublishToPrefix: 'The call-out goes to',
    confirmPublishToSuffix: 'members. The list is frozen at the moment of publication.',
    confirmPublishTransport:
      'Members who have turned Web Push on may get an operational alert. For everyone else the call-out stays visible in the application. Acceptance by a push service is not proof that a phone rang or that a member opened the call-out. There is no SMS, no Viber and no automatic telephone call.',
    publishedWorkerReached:
      'The call-out is published. The server accepted the request to process push; the delivery view shows what a provider accepted, and whether the call-out was opened remains a separate fact.',
    publishedWorkerQueued:
      'The call-out is published. The push messages stayed queued for the server to process; this is not confirmation that a phone rang.',

    confirmCloseTitle: 'Close the intervention?',
    confirmCloseAction: 'Close',
    confirmDiscardTitle: 'Discard the draft?',
    confirmDiscardAction: 'Discard',
    fieldReason: 'Reason',
    reasonStaysHint: 'It stays on the record permanently.',
    openIntervalsPrefix: 'Another',
    openIntervalsSuffix:
      'members are checked in and have not checked out. They stay open on the record - their time will not be invented.',

    pickInterventionTitle: 'Choose an intervention',
    overviewNeedsOne: 'The overview shows the state of one intervention.',
    draftNotPublishedTitle: 'The draft has not been published',
    draftNotPublishedText: 'Nobody has been called out, so there are no answers to show.',

    nowOnScene: 'On scene now',
    nowOnSceneNote: 'The state at this moment. Every cumulative number and time is below, in the response overview.',
    countOnTask: 'On the task now',
    countVehiclesOut: 'Vehicles out',
    auditMissing:
      'The chronology was not read from the server, so some movement times and the names of those who changed a state are not shown.',

    whoIsWhere: 'Who is where',
    whoIsWhereLabel: 'Response overview by member',
    colOpened: 'Opened',
    chipOpened: 'Opened',
    chipNotOpened: 'Not opened',
    chipNoMovement: 'Not reported',
    chipCheckedIn: 'Checked in',
    chipConfirmed: 'Confirmed',
    chipAwaiting: 'Awaiting confirmation',
    chipNoRecord: 'No record',
    timingsNote:
      'Every time comes from the server. Durations are calculated from full timestamps rather than from the minutes on screen, and anything unrecorded is marked as such.',

    attendanceNeedsOne: 'Attendance is kept per intervention.',
    officialTitle: 'Official participation time',
    officialNote:
      'Only confirmed, closed attendance is counted. A record that is awaiting confirmation or has been rejected does not enter this number - not even in part.',
    openRecordsPrefix: 'Another',
    openRecordsSuffix:
      'records are open. An open record has no duration until the member checks out, so it is not counted.',

    pendingTitle: 'Awaiting confirmation',
    pendingEmpty: 'No records are waiting',
    pickAll: 'Select all',
    pickNone: 'Clear selection',
    confirmPicked: 'Confirm selected',
    confirmNoteRule:
      'Confirming does not ask for a note: thirty identical sentences would not be a record, they would be litter. Rejecting and withdrawing a confirmation do ask for a reason, because they change what a member said about themselves.',
    stillCheckedIn: 'still checked in',
    confirmedMany: 'Records confirmed',
    confirmedSome: 'Confirmed',
    notConfirmedSome: 'not confirmed',
    confirmOne: 'Confirm',
    confirmedOneMessage: 'The attendance is confirmed.',
    reject: 'Reject',
    correctTime: 'Correct the time',

    confirmedTitle: 'Confirmed',
    confirmedEmpty: 'Nothing has been confirmed yet',
    unconfirm: 'Withdraw confirmation',

    rejectedTitle: 'Rejected',
    rejectedNote:
      'A rejected record stays in the register with its reason. It is not deleted - deleting it would hide that somebody claimed to have been there.',
    reasonLabel: 'Reason',

    recordForMemberTitle: 'Record attendance for a member',
    recordForMemberNote:
      'A record entered by command is marked as recorded by command and still awaits confirmation. "I wrote it down" and "I stand behind it" are not the same claim.',
    checkOutMember: 'Check out',
    checkInMember: 'Check in',
    checkOutRecorded: 'the check-out is recorded.',
    checkInRecorded: 'the check-in is recorded and awaits confirmation.',

    confirmRejectTitle: 'Reject this attendance record?',
    confirmUnconfirmTitle: 'Withdraw the confirmation?',
    confirmCorrectTitle: 'Correct the time?',
    reasonPermanentHint: 'It stays with the record permanently, with your name and the time.',
    signedBy: 'The decision is signed by',
    rejectedMessage: 'The record is rejected and stays visible with its reason.',
    unconfirmedMessage: 'The confirmation is withdrawn. The record is waiting again.',
    correctedMessage: 'The correction is recorded with its reason.',

    vehiclesNote: 'A vehicle leaving is its own fact. It states nobody’s attendance and changes nobody’s answer.',
    vehiclesEmptyTitle: 'No vehicles have been entered',
    vehiclesEmptyText: 'Vehicles are entered on the Records screen.',
    vehicleOutOfService: 'Out of service',
    vehicleOnScene: 'Out',
    vehicleAtStation: 'At the station',
    vehicleDeparted: 'Departed',
    recordDeparture: 'Record departure',
    recordReturn: 'Record return',
    departureRecorded: 'the departure is recorded.',
    returnRecorded: 'the return is recorded.',
  },

  common: {
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm',
    save: 'Save',
    back: 'Back',
    details: 'Details',
    showMore: 'Show more',
    showLess: 'Show less',
    loading: 'Loading...',
    none: 'None',
    total: 'Total',
    time: 'Time',
    status: 'Status',
    member: 'Member',
    required: 'required',
    optional: 'optional',
    yes: 'Yes',
    no: 'No',
  },

  vocabulary: {
    interventionKind: {
      POZAR: 'Fire',
      SAOBRACAJNA_NEZGODA: 'Road accident',
      TEHNICKA_POMOC: 'Technical assistance',
      VJEZBA: 'Exercise',
      TEST: 'Test',
      DRUGO: 'Other',
    },

    interventionStatus: {
      DRAFT: 'Draft',
      PUBLISHED: 'Published',
      ASSEMBLING: 'Assembling',
      DEPLOYED: 'On scene',
      CONTAINED: 'Contained',
      CLOSED: 'Closed',
      CANCELLED: 'Cancelled',
    },

    answer: {
      DOLAZIM: 'Coming',
      DOLAZIM_KASNIJE: 'Coming later',
      NE_MOGU: 'Cannot come',
    },

    journey: {
      KRECEM: 'Setting off',
      U_PUTU: 'On the way',
      NA_LICU_MJESTA: 'On scene',
      ODUSTAJEM: 'Turning back',
    },

    attendanceSource: {
      SELF_DECLARED: 'Stated by the member',
      COMMAND_RECORDED: 'Recorded by command',
      UNKNOWN: 'Origin unknown',
    },

    attendanceState: {
      PENDING: 'Awaiting confirmation',
      CONFIRMED: 'Confirmed',
      REJECTED: 'Rejected',
    },

    role: {
      OWNER: 'Owner',
      ADMIN: 'Administrator',
      COMMANDER: 'Commander',
      FIREFIGHTER: 'Firefighter',
      CITIZEN: 'No operational rights',
    },

    noAnswer: 'No answer',
    unnamedActor: 'Unknown account',

    auditEvent: {
      INTERVENTION_DRAFTED: 'prepared a draft call-out',
      INTERVENTION_DRAFT_UPDATED: 'changed the draft before publishing',
      INTERVENTION_DRAFT_DISCARDED: 'discarded the draft',
      INTERVENTION_PUBLISHED: 'published the call-out',
      INTERVENTION_STATUS_CHANGED: 'changed the state of the intervention',
      INTERVENTION_CLOSED: 'closed the intervention',
      INTERVENTION_CANCELLED: 'cancelled the intervention',
      JOURNEY_PROGRESS_SET: 'reported their movement',
      ATTENDANCE_CHECK_IN: 'recorded an arrival',
      ATTENDANCE_CHECK_OUT: 'recorded a departure',
      ATTENDANCE_CONFIRMED: 'confirmed the stated attendance',
      ATTENDANCE_UNCONFIRMED: 'withdrew the confirmation of attendance',
      ATTENDANCE_REJECTED: 'rejected the stated attendance',
      ATTENDANCE_CORRECTED: 'corrected the attendance record',
      VEHICLE_DEPARTED: 'recorded a vehicle leaving',
      VEHICLE_RETURNED: 'recorded a vehicle returning',
    },
  },
};
