// Preserve CSS module scoping in the isolated dashboard webpack preview.
export default function dashboardCss(source) {
  const globalSelectors = new Set([...source.matchAll(/:global\(([^)]+)\)/g)]
    .flatMap(match => [...match[1].matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(item => item[1])))
  const names = new Set([...source.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(match => match[1])
    .filter(name => !globalSelectors.has(name)))
  const tokens = Object.fromEntries([...names].map(name => [name, `dashboardMap_${name}`]))
  const css = source.replace(/:global\(([^)]+)\)/g, '$1')
    .replace(/\.([a-zA-Z_][\w-]*)/g, (match, name) => tokens[name] ? `.${tokens[name]}` : match)
  return `const css = ${JSON.stringify(css)}; const node = document.createElement('style'); node.textContent = css; document.head.append(node); export default ${JSON.stringify(tokens)};`
}
