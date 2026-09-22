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
    name: 'Boka Operativa',
    subtitle: 'Mobilisation and records',
    mark: 'BO',
  },

  serverErrors: {
    generic: "The server refused the request. The change was not saved.",
    permissionDenied: "The server refused the request: you do not have access.",
    unavailable: "The server is currently unavailable. Check your connection and try again.",
    operations: {
      COMMAND_REQUIRED: "You do not have commander permissions for this action.",
      ADMIN_REQUIRED: "You do not have administrator permissions for this action.",
      OWNER_REQUIRED: "Only the owner can do this.",
      STAFF_REQUIRED: "Your account does not have operational access.",
      MEMBER_RECORD_REQUIRED: "Your account is not linked to an organisation member.",
      NOT_A_RECIPIENT: "You are not on the recipient list for this intervention.",
      INTERVENTION_NOT_FOUND: "The intervention no longer exists.",
      INTERVENTION_NOT_OPEN: "The intervention is closed or cancelled.",
      INTERVENTION_NOT_PUBLISHED: "The intervention has not been published yet.",
      INTERVENTION_NOT_DRAFT: "The intervention is no longer a draft.",
      VERSION_CONFLICT: "Someone has changed this intervention. Refresh the view.",
      ALREADY_CHECKED_IN: "You are already checked in to this intervention.",
      NOT_CHECKED_IN: "You are not checked in, so there is nothing to check out of.",
      INTERVAL_NOT_FOUND: "That attendance record no longer exists.",
      INTERVAL_REJECTED: "That record was rejected. Return it to pending first.",
      INTERVAL_CONFIRMED: "That record is already confirmed. Withdraw confirmation first.",
      REASON_REQUIRED: "A reason of at least two characters is required.",
      VEHICLE_NOT_FOUND: "The vehicle no longer exists.",
      VEHICLE_NOT_IN_SERVICE: "The vehicle is not in service.",
      VEHICLE_ALREADY_OUT: "That vehicle is already deployed.",
      VEHICLE_ALREADY_RETURNED: "The return of that vehicle has already been recorded.",
      MOVEMENT_NOT_FOUND: "That vehicle departure record no longer exists.",
      INVALID_PROGRESS: "Unknown movement status.",
      INVALID_ANSWER: "Unknown response.",
      INVALID_KIND: "Unknown intervention type.",
      INVALID_COORDINATES: "The coordinates are invalid.",
      INVALID_INTERVAL: "The end must be after the start.",
      ETA_REQUIRED: "Choose your estimated arrival time.",
      TITLE_REQUIRED: "The title must contain at least three characters.",
      INSTRUCTIONS_REQUIRED: "The instructions must contain at least three characters.",
      LOCATION_REQUIRED: "A location is required.",
      KIND_NOTE_REQUIRED: "Enter a short description for the \"Other\" type.",
      IDEMPOTENCY_KEY_REQUIRED: "The request key is missing. Try again.",
      NO_RECIPIENTS: "Select at least one member.",
      NO_ACTIVE_RECIPIENTS: "None of the selected members are active.",
      NO_INTERVALS: "No records are selected.",
      TOO_MANY_INTERVALS: "Too many records at once. Split them into smaller groups.",
      AVAILABILITY_REQUIRED: "Select your availability.",
      NOTE_TOO_LONG: "The note is too long.",
      CORRECTION_WOULD_OVERLAP: "The correction would overlap another record for the same member.",
      OPEN_ATTENDANCE_INTERVALS: "Some members are still checked in. Confirm that their attendance intervals should remain open.",
    },
    roster: {
      ADMIN_REQUIRED: "The server refused the request: only an administrator or owner can change these records.",
      COMMAND_REQUIRED: "The server refused the request: commander permissions are required.",
      MEMBER_ALREADY_LINKED: "That member already has a linked account. Unlink it first.",
      ACCOUNT_ALREADY_LINKED: "That account is already linked to another member.",
      MEMBER_NOT_FOUND: "The member no longer exists. Refresh the list.",
      GROUP_NOT_FOUND: "The group no longer exists. Refresh the list.",
      VEHICLE_NOT_FOUND: "The vehicle no longer exists. Refresh the list.",
      ACCOUNT_NOT_FOUND: "The account no longer exists. Refresh the list.",
      GROUP_NAME_TAKEN: "A group with that name already exists.",
      CALLSIGN_TAKEN: "A vehicle with that callsign already exists.",
      CALLSIGN_REQUIRED: "A vehicle callsign is required.",
      FULL_NAME_REQUIRED: "The full name must contain at least two characters.",
      NAME_REQUIRED: "A name of at least two characters is required.",
      REASON_REQUIRED: "A reason of at least two characters is required.",
    },
  },

  live: {
    OFF: 'Automatic updates are off',
    CONNECTING: 'Connecting to the server...',
    LIVE: 'Live - changes arrive automatically',
    POLLING: 'Refreshes every 12 seconds',
  },

  accountAccess: {
    kicker: 'Server account', title: 'Sign in and access',
    notConfigured: 'The server is not configured. Operational features are unavailable until it is connected.',
    checking: 'Checking access with the server...',
    serverUnavailable: 'The server is unavailable, so access cannot be checked. The application grants no access until the check succeeds.',
    accountBroken: 'The account exists, but its profile was not found. Contact the system owner.',
    signIn: 'Sign in', register: 'Create account', email: 'Email', password: 'Password',
    confirmPassword: 'Confirm password', phone: 'Telephone number', birthDate: 'Date of birth',
    phoneHint: 'Enter a Montenegro number beginning with zero or a full international number, for example +382 67 123 456.',
    passwordHint: 'At least 12 characters.', invalidFullName: 'Enter your full name.',
    invalidPhone: 'Enter a valid telephone number.',
    invalidBirthDate: 'Enter a valid date of birth that is not in the future.',
    passwordMismatch: 'The passwords do not match.',
    invalidEmail: 'Enter a valid email address.', shortPassword: 'The password must be at least 12 characters.',
    wait: 'Please wait...', noAccount: 'I do not have an account', haveAccount: 'I already have an account',
    requestReceived: 'Request received. If this is a new address, check your email for confirmation. If the account already exists, sign in with your current password.',
    profileRequired: 'Complete your full name, telephone number and date of birth so the owner can identify who is requesting access.',
    fullName: 'Full name', displayOnly: 'Display information only. It does not grant operational access.',
    saveProfile: 'Save profile', saving: 'Saving...', signOut: 'Sign out',
    profileSaveFailed: 'The profile could not be saved. Check the details and try again.',
    resetUnavailable: 'Password reset is not available yet. After email setup, the owner can send a one-time recovery code.',
    suspended: 'Access to this account has been temporarily suspended. The reason is recorded on the server; contact the system owner.',
    citizenAccess: 'The account is active as a citizen account. Only the personal account and settings are available; DVD and SZS operational data is not visible. The owner can later assign DVD, SZS or both services.',
    szsMembershipActive: '{organization} membership is active with the role {role}. SZS operational data is not open in this phase, and DVD data remains unavailable without a DVD role.',
    signedInAs: 'Signed-in account', serverRole: 'DVD operational role',
    servicesAndRoles: 'Services and roles', noServiceMembership: 'No service assigned',
    checkingServices: 'Checking services and roles...',
    servicesUnavailable: 'Services and roles could not be checked. Try again; the application does not assume access.',
    roleFromServer: 'The server supplied these roles at the last check. The application does not store or assume them.',
    checkAgain: 'Check access again', retry: 'Try again',
    unknownRole: 'Unknown role',
    credentialError: 'Sign-in failed. Check your email and password, then try again.',
    networkError: 'The server is unavailable. The request did not reach the server or no response was received. Check your internet connection and try again.',
    networkBlocked: 'The server is still unavailable. If you otherwise have internet access, a content blocker, browser privacy protection or your network may be blocking the request. Try another browser or network, or contact the system owner.',
  },

  recovery: {
    forgot: 'Forgot password',
    title: 'Reset forgotten password',
    intro: 'Enter the account email. If the account exists, a one-time code will be sent to that address.',
    send: 'Send code',
    received: 'The request was received. If the account exists, check your email and enter the code. Every address receives the same on-screen response.',
    code: 'Code from email',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    save: 'Change password',
    resend: 'Send a new code',
    changeEmail: 'Change email',
    cooldown: 'You can request a new code in {seconds} s.',
    invalidCode: 'The code is invalid or has expired. Check it or request a new code.',
    mismatch: 'The passwords do not match.',
    updateFailed: 'The password may not have changed. Try signing in with the new password or request a new code.',
    done: 'The password was changed. You can now sign in with the new password.',
    back: 'Back to sign-in',
  },

  accounts: {
    pageTitle: 'Accounts and access', ownerOnly: 'System owner only', allAccounts: 'Registered accounts',
    accountCount: 'Accounts: {count}', risk: 'These are server accounts. Service, role and access changes take effect immediately and are recorded below.',
    search: 'Search by name, email, service, role or status', loading: 'Loading accounts from the server...',
    noResults: 'No results', noAccounts: 'The server returned no accounts.', changeSearch: 'Change the search term.',
    account: 'Account', status: 'Status', role: 'Role', access: 'Access', noName: 'Name not entered',
    ownAccountLocked: 'You cannot change your own account here.', ownerLocked: 'The owner account is protected.',
    reasonForAccess: 'Reason for changing access', reasonRequired: 'Reason (required)',
    revokeAccess: 'Revoke access', restoreAccess: 'Restore access', reasonMissing: 'A reason is required. Enter why access is changing.',
    changedRole: 'Role changed to: {role}.', changeFailed: 'The change was not saved.', reasonNeeded: 'A reason is required.',
    organizationLabel: { DVD: 'DVD Tivat', SZS: 'Protection and Rescue Service Tivat' },
    noMembership: 'Not a member',
    changedMembership: '{organization}: {role}.',
    membershipChanged: '{organization} - role: {role}',
    resetReady: 'The owner may send a one-time code to the registered email. Passwords are never shown or set in the admin panel.',
    resetUnavailable: 'Code delivery is ready but disabled until SMTP and real email delivery pass acceptance.',
    sendReset: 'Send reset code', resetSentShort: 'Code sent',
    resetSent: 'The request was sent to the user\'s registered email.',
    resetFailed: 'The code could not be sent. Check the email service and try again.',
    multiServicePending: 'DVD management is active. SZS assignment unlocks only after the new database passes verification, so an SZS account cannot see DVD data.',
    multiServiceReady: 'Service assignment is active. Every account starts as a citizen; the owner can then assign DVD, the Protection and Rescue Service, or both. An SZS role does not open DVD operational data.',
    accessRestored: 'Access restored.', accessRevoked: 'Access revoked.',
    auditKicker: 'Permanent audit', auditTitle: 'Service, role and access changes', noAudit: 'No records yet',
    auditHint: 'This log updates when a membership, role or access changes.',
    roleChanged: 'role {from} → {to}', roleChangedTo: 'role set to {role}',
    accessChange: 'access restored', accessRemoval: 'access revoked',
    registration: 'Registration', registrationTitle: 'How a new account gets access',
    emailPassword: 'Email and password', accountCreatedByUser: 'The user creates an account.',
    nameAndSurname: 'Identity and contact details', displayNotProof: 'Full name, telephone number and date of birth. These details grant no operational access.',
    phoneAndBirthDate: 'Telephone and date of birth',
    linkedMember: 'Linked to a member record', notLinkedMember: 'Not linked to a member',
    openRoster: 'Open Records',
    citizenAccessLabel: 'Citizen access', noRights: 'A new account sees only its own account and settings; it has no operational data.',
    ownerDecision: 'Owner decision', ownerAssigns: 'Only the owner can assign DVD, SZS or both services.',
    serverCheck: 'Server check', serverChecksRole: 'The server checks the role on every request.',
    roleLabel: { OWNER: 'System owner', ADMIN: 'Administrator', COMMANDER: 'Commander', FIREFIGHTER: 'Firefighter', PENDING: 'Awaiting approval (legacy label)', CITIZEN: 'Citizen' },
    statusLabel: { UNKNOWN: 'Unknown', PROFILE_REQUIRED: 'Profile incomplete', ACTIVE: 'Active', SUSPENDED: 'Access suspended' },
    loadFailed: 'Accounts could not be loaded from the server.',
    commandErrors: {
      ownerRequired: 'The server refused the request: only the system owner can change access.',
      ownAccount: 'The owner cannot change their own account, which could lock them out.',
      protectedAccount: 'The owner account is protected and cannot be changed in the application.',
      roleNotAssignable: 'That role cannot be assigned.',
      reasonRequired: 'A reason of at least two characters is required.',
      accountNotFound: 'The account no longer exists. Refresh the list.',
      organizationNotFound: 'The service does not exist or is currently inactive.',
      generic: 'The server refused the request. The change was not saved.',
    },
  },

  organisation: {
    pageTitle: 'Organisation records', adminOnly: 'Administrator or owner only',
    signInFirst: 'Sign in to view these records.',
    denied: 'Administrators and owners maintain these records. Commanders manage interventions but do not change the organisation roster.',
    serverData: 'Server records', tabs: 'Records section', members: 'Members', groups: 'Groups', vehicles: 'Vehicles',
    loading: 'Loading records...', loadFailed: 'Records could not be loaded from the server.',
    changeFailed: 'The change was not saved.', unreadyOne: 'One member cannot receive a call-out.', unreadyMany: '{count} members cannot receive a call-out.',
    unreadyExplain: 'Review active status and account link for each flagged member.',
    newMember: 'New member full name', addMember: 'Add member', memberAdded: 'Member added.', noMembers: 'No members entered',
    addFirstMember: 'Add the first member before sending an intervention.', memberList: 'Member list',
    account: 'Account', state: 'State', action: 'Action', linked: 'Linked', notLinked: 'Not linked',
    linkAccount: 'Link account to member', linkAccountOption: 'Link account...', accountLinked: 'Account linked to member.',
    unlinkAccount: 'Unlink account', unlinkReason: 'Reason for unlinking member account', accountUnlinked: 'Account unlinked from member.',
    compositionReason: 'Reason for roster change for', removeFromRoster: 'Remove from roster', restoreToRoster: 'Restore to roster',
    removedFromRoster: 'Member removed from roster.', restoredToRoster: 'Member restored to roster.',
    newGroup: 'New group name', addGroup: 'Add group', groupAdded: 'Group added.', noGroups: 'No groups entered',
    groupsHint: 'Groups let you send a call-out to a team instead of selecting people one by one.',
    addMembersFirst: 'Add members before assigning them to groups.', removedFromGroup: 'Member removed from group.', addedToGroup: 'Member added to group.',
    vehiclePrivacy: 'Enter the vehicle code, name and type. Licence plates and other sensitive vehicle details are not part of these records.',
    callsign: 'Vehicle code', vehicleName: 'Vehicle name', kind: 'Type', vehicleKindHint: 'For example: pumper, tanker or technical rescue.', addVehicle: 'Add vehicle', noVehicles: 'No vehicles entered', vehicleList: 'Vehicle list',
    inService: 'In service', outOfService: 'Out of service', vehicleReason: 'Reason for changing vehicle status', vehicleAdded: 'Vehicle added.', vehicleTakenOut: 'Vehicle taken out of service.', vehicleRestored: 'Vehicle returned to service.',
    readiness: { READY: 'Can receive call-outs', NO_ACCOUNT: 'No linked account', INACTIVE: 'Inactive member' },
    tableMembers: 'Organisation members and account status', tableVehicles: 'Organisation vehicles',
    reason: 'Reason',
  },

  nav: {
    groupWork: 'Work',
    groupSociety: 'Society',
    main: 'Main navigation',
    workspace: 'Boka Operativa',
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
    identityNoRole: 'Citizen / no DVD role',
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

    noDvdRoleTitle: 'This account has no DVD operational role.',
    noDvdRoleText: 'The account and settings remain available. The owner can assign DVD, SZS or both services; SZS membership alone does not open DVD operational data.',

    noMemberTitle: 'Your account is not linked to a member of the society.',
    noMemberText:
      'Because of that you cannot be put on a call-out list and you cannot state your attendance. An administrator links it on the Records screen.',
    noMemberUntilThen: 'Until then this screen has nothing to show for you.',

    memberCheckFailedTitle: 'We could not check your member record.',
    memberCheckFailedText:
      'The server did not answer that check. This does not mean you are not a member of the society - it means we do not know.',
    memberCheckRefusedTitle: 'The server refused to check your member record.',
    memberCheckRefusedText:
      'The server answered and refused the check, so trying again will not help. This says nothing about whether you are a member of the society. Contact the owner of the system - this is fixed with server access rights, not by waiting.',
  },

  connection: {
    offlineTitle: 'This device is offline.',
    offlineText:
      'The operational screens cannot read the current state from the server, and anything you enter now will not be saved. Try again as soon as the connection returns.',
    updateTitle: 'A new version is ready.',
    updateText:
      'It is applied only when you ask for it, so the application cannot change under you mid-task.',
    updateAction: 'Refresh the application',
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

    installOnIos: 'On an iPhone, first choose Share - Add to Home Screen, open Boka Operativa from that icon, then turn notifications on here.',
    unsupported: 'This browser does not support reliable Web Push notifications.',
    notConfigured: 'The push service is not yet connected to this published version.',
    denied: 'Notifications are refused in the phone’s settings. Allow them for Boka Operativa, then open the application again.',
    failed: 'The notification was not set up. Check the connection and try again.',

    memberRequired:
      'Your account is not linked to a member of the society, so it cannot receive a call-out. Open Records - Members, add your member record and link it to this account.',
    accessRequired:
      'Your account has no operational role, so it cannot receive a call-out. Ask the system owner.',
    deviceRejected:
      'The server refused this device’s details. That is a fault in the application, not in your phone - please report it.',
    serverRefused:
      'The server refused to register this device and gave no reason this version recognises. Your connection is working.',
    subscriptionConflict:
      'This device is already registered to another account. Sign that account out on this device, then try again.',
    unreachable: 'The server could not be reached. Check the connection and try again.',

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
    refusedRead: 'The server refused to load call-outs. Check whether your account still has operational access.',
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
    refusedRead: 'The server refused to load the archive. Check whether your account still has operational access.',
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

    stepDetails: 'What happened',
    stepWhere: 'Where and what to do',
    stepWho: 'Who',
    stepReview: 'Review',
    wizardNext: 'Next',
    wizardBack: 'Back',
    wizardToReview: 'Next: review',
    reviewTitle: 'Check before sending',
    reviewRecipients: 'members receive this call-out',
    draftIsNotSent: 'Saving a draft calls nobody. It is sent at the Review step.',
    draftRestored: 'What you started earlier on this device has been restored. It was not sent to anybody.',

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

  callout: {
    nextLabel: 'Next',
    nothingLabel: 'Nothing further',

    doAcknowledge: 'I have seen the call-out',
    doAcknowledgeWhy: 'Tell the commander it reached you.',
    doAnswer: 'Are you coming?',
    doAnswerWhy: 'The commander is waiting for your answer.',
    doMove: 'Report where you are',
    doMoveWhy: 'This does not state attendance - not even "On scene".',
    doCheckIn: 'State my attendance',
    doCheckInWhy: 'The commander confirms it; until then it does not count as participation.',
    doCheckOut: 'Check out',
    doCheckOutWhy: 'You have been checked in since earlier.',
    doneTitle: 'Nothing further for you',
    doneClosed: 'The intervention is closed. The record stays visible.',
    doneDeclined: 'You said you cannot come.',
    doneTurnedBack: 'You said you are turning back.',

    factAcknowledged: 'Seen',
    factAnswered: 'Answered',
    factMoving: 'Moving',
    factAttending: 'Attendance',
    factDone: 'yes',
    factPending: 'no',
    attendancePending: 'Awaiting confirmation',
    attendanceConfirmed: 'Confirmed',
    myStatus: 'What you have told them',

    etaQuestion: 'How long until you arrive?',
    changeAnswer: 'Change answer',
    moreActions: 'Other actions',
    attendanceRecord: 'My attendance records',
    closedNotice: 'This intervention is closed and no longer changes.',
  },

  responseBar: {
    title: 'Response',
    invited: 'Called out',
    coming: 'Coming',
    later: 'Later',
    declined: 'Cannot',
    noAnswer: 'No answer',
    onScene: 'On scene',
    seeAll: 'Who is where',
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
    moreInfo: 'More information',
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
