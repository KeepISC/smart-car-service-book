let revision = 0

export function maintenanceRevision() {
  return revision
}

export function notifyMaintenanceChange() {
  revision += 1
  window.dispatchEvent(new Event('app:maintenance-change'))
}
