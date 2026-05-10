<template>
  <div class="text-center space-y-6 py-4">
    <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-500 mb-2">
      <UIcon name="i-lucide-layers" class="w-8 h-8 text-white" />
    </div>
    <div>
      <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Welcome to NuxFlow</h2>
      <p class="mt-2 text-gray-500 dark:text-gray-400 max-w-md mx-auto">
        A modern, open-source CMS built on Nuxt 4 and Cloudflare Workers. Let's get your site set up in a few steps.
      </p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left mt-6">
      <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
        <UIcon name="i-lucide-zap" class="w-5 h-5 text-primary-500 mb-2" />
        <p class="text-sm font-medium text-gray-900 dark:text-white">Edge-deployed</p>
        <p class="text-xs text-gray-500 mt-1">Runs on Cloudflare Workers — globally fast, zero cold starts.</p>
      </div>
      <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
        <UIcon name="i-lucide-database" class="w-5 h-5 text-primary-500 mb-2" />
        <p class="text-sm font-medium text-gray-900 dark:text-white">Turso powered</p>
        <p class="text-xs text-gray-500 mt-1">Globally distributed SQLite via libSQL for ultra-low latency.</p>
      </div>
      <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
        <UIcon name="i-lucide-puzzle" class="w-5 h-5 text-primary-500 mb-2" />
        <p class="text-sm font-medium text-gray-900 dark:text-white">Plugin ecosystem</p>
        <p class="text-xs text-gray-500 mt-1">Extend with forms, memberships, and third-party integrations.</p>
      </div>
    </div>

    <p class="text-xs text-gray-400">Setup takes about 2 minutes. You can change everything later.</p>
  </div>
</template>
