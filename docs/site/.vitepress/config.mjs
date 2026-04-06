import { defineConfig } from 'vitepress'

const selfHostingGuide = [
  { text: 'Self-Hosting', link: '/guides/self-hosting' },
  { text: 'Admin Setup', link: '/guides/admin-setup' },
  { text: 'Signing Setup', link: '/guides/signing-setup' },
  { text: 'Instance Admin', link: '/guides/instance-admin' },
  { text: 'Backup & Restore', link: '/guides/backup-restore' },
  { text: 'Server Export', link: '/guides/server-export' },
  { text: 'Architecture', link: '/guides/architecture' },
  { text: 'Release Roadmap', link: '/guides/release-roadmap' },
]

const featuresGuide = [
  { text: 'Overview', link: '/features/overview' },
  { text: 'Text Channels & Threads', link: '/features/channels' },
  { text: 'Voice & Go Live', link: '/features/voice-and-screen-share' },
  { text: 'Direct Messages', link: '/features/direct-messages' },
  { text: 'Authentication', link: '/features/authentication' },
  { text: 'Roles & Permissions', link: '/features/roles-and-permissions' },
  { text: 'Channel Categories', link: '/features/channel-categories' },
  { text: 'Channel Permissions', link: '/features/channel-permissions' },
  { text: 'Invites', link: '/features/invites' },
]

const featuresMessages = [
  { text: 'Message Editing & Deletion', link: '/features/message-editing-deletion' },
  { text: 'Message Pinning', link: '/features/message-pinning' },
  { text: 'Message Search', link: '/features/message-search' },
  { text: 'Reactions', link: '/features/reactions' },
  { text: 'Polls & Events', link: '/features/polls-and-events' },
  { text: 'Link Previews & GIFs', link: '/features/link-previews-and-giphy' },
  { text: 'Custom Emojis', link: '/features/custom-emojis' },
]

const featuresModeration = [
  { text: 'Auto-Moderation', link: '/features/auto-moderation' },
  { text: 'Member Moderation', link: '/features/member-moderation' },
  { text: 'Audit Logging', link: '/features/audit-logging' },
  { text: 'Presence Status', link: '/features/presence-status' },
]

const apiReference = [
  { text: 'REST API Overview', link: '/reference/api-reference' },
  { text: 'Bot API', link: '/reference/bot-api' },
  { text: 'Webhooks', link: '/reference/webhooks' },
  { text: 'Websocket Protocol', link: '/reference/websocket-protocol' },
  { text: 'Server Discovery', link: '/reference/server-discovery' },
]

const devReference = [
  { text: 'Project Structure', link: '/reference/project-structure' },
  { text: 'OpenAPI Spec', link: '/reference/openapi' },
  { text: 'iOS Voice', link: '/reference/ios-voice' },
]

export default defineConfig({
  title: 'Together',
  description: 'Self-hosted docs for Together — a Discord alternative for small gaming communities.',
  base: '/',
  srcDir: 'docs',

  ignoreDeadLinks: [/^https?:\/\//],

  themeConfig: {
    logo: { src: '/logo.svg', width: 24, height: 24, alt: 'Together' },

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Self-Hosting', link: '/guides/self-hosting' },
      { text: 'Features', link: '/features/overview' },
      { text: 'API Reference', link: '/reference/api-reference' },
      { text: 'together-chat.com', link: 'https://together-chat.com' },
      { text: 'GitHub', link: 'https://github.com/jtjenkins/Together' },
    ],

    sidebar: {
      '/guides/': [
        { text: 'Self-Hosting', items: selfHostingGuide, collapsed: false },
      ],
      '/features/': [
        { text: 'Getting Started', items: featuresGuide, collapsed: false },
        { text: 'Messaging', items: featuresMessages, collapsed: true },
        { text: 'Moderation', items: featuresModeration, collapsed: true },
      ],
      '/reference/': [
        { text: 'API Reference', items: apiReference, collapsed: false },
        { text: 'Development', items: devReference, collapsed: true },
      ],
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/jtjenkins/Together/edit/main/docs/site/docs/:path',
      text: 'Edit this page on GitHub',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/jtjenkins/Together' },
    ],

    footer: {
      message: 'Released under the <a href="https://github.com/jtjenkins/Together/blob/main/LICENSE" target="_blank" rel="noopener">PolyForm Noncommercial License</a>.',
      copyright: 'Copyright © 2026 Together',
    },
  },
})
