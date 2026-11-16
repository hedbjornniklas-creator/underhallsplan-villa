export default function FixtureImage({ fill: _fill, unoptimized: _unoptimized, ...props }: Record<string, unknown>) {
  return <img {...props} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
}
