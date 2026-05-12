-- Add cryptographic signing fields to dynamic_plugins.
-- serverChecksum / clientChecksum: SHA-256 hex of raw code in KV — verified on every load.
-- publisherPublicKey: base64url SPKI Ed25519 public key — stored on first install.
-- signature: base64url Ed25519 signature over canonical payload — verified on install/update.

ALTER TABLE `dynamic_plugins` ADD `server_checksum` text;--> statement-breakpoint
ALTER TABLE `dynamic_plugins` ADD `client_checksum` text;--> statement-breakpoint
ALTER TABLE `dynamic_plugins` ADD `publisher_public_key` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `dynamic_plugins` ADD `signature` text NOT NULL DEFAULT '';
