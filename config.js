/* Firebase project settings for the HEL16 Site Tracker.
   These values are not secret: access is controlled by the security rules in firebase/. */
window.HEL16_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyBwSYZ8KQzkAe2nEyLiMNXWqGyYAAvYkHY',
    authDomain: 'hel16-tracker.firebaseapp.com',
    projectId: 'hel16-tracker',
    storageBucket: 'hel16-tracker.firebasestorage.app',
    messagingSenderId: '160015958358',
    appId: '1:160015958358:web:295e3096a75ad31ee9d6f7',
  },
  // Always Editors, even before the team list exists. Must match firebase/firestore.rules.
  owners: ['joepbc76@gmail.com', 'joe@okee.ie'],
};
