/* Firebase project settings for the HEL16 Site Tracker.
   These values are not secret: access is controlled by the security rules in firebase/. */
window.HEL16_CONFIG = {
  firebase: {
    apiKey: 'PASTE_FROM_FIREBASE',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },
  // Always Editors, even before the team list exists. Must match firebase/firestore.rules.
  owners: ['joepbc76@gmail.com', 'joe@okee.ie'],
};
