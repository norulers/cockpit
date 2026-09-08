<template>
  <div class="space-y-3 py-4 text-center text-sm opacity-80">
    <p>
      {{
        $t(
          'You have finished reviewing the default configuration for {vehicleTypeName}. This dialog will not open automatically again for this vehicle.',
          { vehicleTypeName: evaluation?.vehicleTypeName }
        )
      }}
    </p>
    <p>
      {{
        $t(
          'If you want to import default views or joystick mapping later, use Import vehicle defaults in the Edit menu, or the import button in Joystick configuration.'
        )
      }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { useVehicleDefaultsAutoImportWizardInject } from '@/composables/vehicleDefaults/useVehicleDefaultsAutoImportWizard'

const { evaluation } = useVehicleDefaultsAutoImportWizardInject()
</script>
