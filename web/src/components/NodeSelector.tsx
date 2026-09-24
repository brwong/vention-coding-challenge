import type { NodeInfo } from '../services/nodeDiscovery'

interface Props {
  nodes: NodeInfo[]
  selectedNodeId?: string
  onSelect: (nodeId: string) => void
}

export function NodeSelector({ nodes, selectedNodeId, onSelect }: Props) {
  return (
    <div className="node-selector" role="radiogroup" aria-label="Selected node">
      {nodes.map((node) => (
        <button
          key={node.nodeId}
          type="button"
          role="radio"
          aria-checked={node.nodeId === selectedNodeId}
          className={node.nodeId === selectedNodeId ? 'selected' : undefined}
          onClick={() => onSelect(node.nodeId)}
        >
          {node.nodeId}
        </button>
      ))}
    </div>
  )
}
