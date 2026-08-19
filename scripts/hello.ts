const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 22) {
  throw new Error(`mini-dsh needs Node 22+, found ${process.versions.node}`)
}
console.log(`mini-dsh workspace OK (node ${process.versions.node}, ESM: ${typeof require === 'undefined'})`)
