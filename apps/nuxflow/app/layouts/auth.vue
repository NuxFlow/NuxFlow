<template>
  <div class="mesh-bg relative min-h-screen flex items-center justify-center overflow-hidden">
    <!-- Decorative colour blobs that give the glass something to blur -->
    <div
      class="orb orb-float"
      style="width: 500px; height: 500px; top: -180px; left: -160px; background: rgba(0, 220, 130, 0.4); animation-delay: 0s;"
    />
    <div
      class="orb orb-float"
      style="width: 420px; height: 420px; top: -120px; right: -150px; background: rgba(56, 189, 248, 0.35); animation-delay: 3s;"
    />
    <div
      class="orb orb-float"
      style="width: 380px; height: 380px; bottom: -140px; left: 35%; background: rgba(139, 92, 246, 0.3); animation-delay: 6s;"
    />

    <!-- Content -->
    <div class="relative z-10 w-full max-w-md px-4 py-12">
      <slot />
    </div>
  </div>
</template>
