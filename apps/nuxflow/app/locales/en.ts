// .ts, not .json — @nuxtjs/i18n's JSON locale loading is broken under Nuxt 4.5+'s Vite 8
// (Rolldown) bundler: unplugin-vue-i18n's JSON-to-JS transform and Vite 8's own native
// `vite:json` plugin both try to handle the same file, and the second one chokes trying
// to JSON.parse the first one's already-compiled JS output ("UNLOADABLE_DEPENDENCY" /
// "is not valid JSON" at build time). A plain default-exported object in a .ts file sidesteps
// the conflict entirely — see https://github.com/nuxt-modules/i18n/issues/3949 and
// https://github.com/intlify/bundle-tools/issues/553 (upstream, unresolved as of this
// writing). Revisit converting back to .json once those land a fix.
export default {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    loading: 'Loading...',
    error: 'Something went wrong',
    success: 'Done!',
    confirm: 'Are you sure?',
  },
  nav: {
    dashboard: 'Dashboard',
    content: 'Content',
    media: 'Media',
    forms: 'Forms',
    users: 'Users',
    themes: 'Themes',
    plugins: 'Plugins',
    settings: 'Settings',
  },
  auth: {
    login: 'Sign in',
    logout: 'Sign out',
    email: 'Email address',
    password: 'Password',
    forgotPassword: 'Forgot password?',
    noAccount: 'Don\'t have an account?',
    signUp: 'Sign up',
  },
  setup: {
    title: 'Welcome to NuxFlow',
    subtitle: 'Let\'s get your site set up in a few steps.',
    steps: {
      site: 'Site details',
      admin: 'Admin account',
      email: 'Email settings',
      appearance: 'Appearance',
      content: 'Content types',
      plugins: 'Plugins',
      done: 'All done!',
    },
  },
}
