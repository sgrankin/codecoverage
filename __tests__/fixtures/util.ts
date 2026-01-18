export function getFixturePath(fileName: string): string {
  const path = __filename.split('/')
  path.pop()
  path.push(fileName)
  return path.join('/')
}
