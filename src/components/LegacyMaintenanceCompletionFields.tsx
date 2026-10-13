import type { MaintenanceInput } from '../types/maintenance'

// Temporary legacy entry path while the Service History build flag is off.
export function LegacyMaintenanceCompletionFields({
  value,
  change,
  mileage,
  today,
}: {
  value: MaintenanceInput
  change: (value: MaintenanceInput) => void
  mileage: number
  today: string
}) {
  return (
    <>
      <label>
        Service history
        <select
          value={value.history_status}
          onChange={(event) =>
            change({
              ...value,
              history_status: event.target
                .value as MaintenanceInput['history_status'],
              last_completed_date: null,
              last_completed_mileage: null,
            })
          }
        >
          <option value="unknown">Unknown</option>
          <option value="known">Known</option>
          <option value="not_applicable">Not applicable</option>
        </select>
      </label>
      {value.history_status === 'known' && (
        <>
          <label>
            Last completed date (optional)
            <input
              type="date"
              max={today}
              value={value.last_completed_date ?? ''}
              onChange={(event) =>
                change({
                  ...value,
                  last_completed_date: event.target.value || null,
                })
              }
            />
          </label>
          <label>
            Last completed mileage (optional)
            <input
              type="number"
              min={0}
              max={mileage}
              step={1}
              value={value.last_completed_mileage ?? ''}
              onChange={(event) =>
                change({
                  ...value,
                  last_completed_mileage:
                    event.target.value === ''
                      ? null
                      : Number(event.target.value),
                })
              }
            />
          </label>
        </>
      )}
    </>
  )
}
