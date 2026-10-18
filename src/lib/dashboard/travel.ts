import type { DashboardDrivingRoute } from './routing'
import type { DashboardMapLocation } from './geocoding'

export type DashboardTravelResponse = {
  organizationId: string
  date: string
  bookingIds: string[]
  includesTentative: boolean
  approximate?: boolean
  origin: {
    status: DashboardMapLocation['status']
    label: string
    address?: string
    latitude?: number
    longitude?: number
  }
  route: Omit<DashboardDrivingRoute, 'status'> & {
    status: DashboardDrivingRoute['status'] | 'origin_missing' | 'locations_missing'
  }
  directionsLinks: string[]
}
