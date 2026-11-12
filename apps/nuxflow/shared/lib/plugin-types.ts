// What Admin → Plugins gets from GET /api/v1/dynamic-plugins
// (server/api/v1/dynamic-plugins/index.get.ts). Never the plugin's settings values (they hold
// encrypted secrets): the settings form reads a masked copy from its own route. Import-free.

/** An installed dynamic plugin (only the fields the admin relies on; the row has more). */
export interface AdminDynamicPlugin {
  id: string
  name: string
  version: string
  description: string
  isActive: boolean
  hasServer: boolean
  hasClient: boolean
  installedAt: string
  /** What the plugin asks for (shared/lib/plugin-permissions.ts). */
  permissions: string[]
  /** What an admin approved when switching it on. */
  grantedPermissions: string[]
  /** The plugin has a settings form. */
  hasSettings: boolean
  /** Asks for permissions that haven't been approved: enabling shows the review. */
  needsApproval: boolean
}

export interface AdminDynamicPluginsResponse {
  plugins: AdminDynamicPlugin[]
}
