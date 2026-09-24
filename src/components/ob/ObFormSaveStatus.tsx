export default function ObFormSaveStatus({ saving }: { saving: boolean }) {
  // Keep the same space before, during and after a background save.
  return (
    <span role="status" aria-live="polite" aria-atomic="true"
      className="block h-6 w-20 shrink-0 whitespace-nowrap text-right text-xs leading-6 text-gray-600">
      {saving ? 'Sparar…' : ''}
    </span>
  )
}
