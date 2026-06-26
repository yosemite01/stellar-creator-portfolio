'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, Eye, XCircle, Circle, ChevronDown, ChevronUp, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import type { Milestone, MilestoneStatus, MilestoneComment } from '@/lib/creators-data'

interface MilestoneTrackerProps {
  milestones: Milestone[]
  /** 'freelancer' can submit; 'client' can accept/reject; undefined = read-only */
  role?: 'freelancer' | 'client'
  onSubmit?: (milestoneId: string) => void
  onAccept?: (milestoneId: string) => void
  onReject?: (milestoneId: string, comment: string) => void
  onComment?: (milestoneId: string, text: string) => void
}

const STATUS_CONFIG: Record<MilestoneStatus, { icon: ReactNode; label: string; color: string }> = {
  pending:   { icon: <Circle className="h-5 w-5" />,       label: 'Pending',     color: 'text-muted-foreground' },
  'in-review': { icon: <Eye className="h-5 w-5" />,        label: 'In Review',   color: 'text-yellow-500' },
  accepted:  { icon: <CheckCircle2 className="h-5 w-5" />, label: 'Accepted',    color: 'text-green-500' },
  released:  { icon: <CheckCircle2 className="h-5 w-5" />, label: 'Released',    color: 'text-blue-500' },
  rejected:  { icon: <XCircle className="h-5 w-5" />,      label: 'Changes Requested', color: 'text-red-500' },
}

function MilestoneRow({
  milestone,
  index,
  total,
  role,
  onSubmit,
  onAccept,
  onReject,
  onComment,
}: {
  milestone: Milestone
  index: number
  total: number
  role?: MilestoneTrackerProps['role']
  onSubmit?: (id: string) => void
  onAccept?: (id: string) => void
  onReject?: (id: string, comment: string) => void
  onComment?: (id: string, text: string) => void
}) {
  const [expanded, setExpanded] = useState(milestone.status === 'in-review')
  const [rejectText, setRejectText] = useState('')
  const [commentText, setCommentText] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)

  const cfg = STATUS_CONFIG[milestone.status]

  function handleReject() {
    if (!rejectText.trim()) return
    onReject?.(milestone.id, rejectText.trim())
    setRejectText('')
    setShowRejectInput(false)
  }

  function handleComment() {
    if (!commentText.trim()) return
    onComment?.(milestone.id, commentText.trim())
    setCommentText('')
  }

  return (
    <div className="relative flex gap-4">
      {/* Vertical timeline line */}
      {index < total - 1 && (
        <div className="absolute left-[18px] top-10 bottom-0 w-px bg-border" />
      )}

      {/* Status icon */}
      <div className={`mt-1 shrink-0 ${cfg.color}`}>{cfg.icon}</div>

      <div className="flex-1 pb-6">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-left group"
          aria-expanded={expanded}
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{milestone.title}</span>
              <Badge variant="outline" className={`text-xs ${cfg.color}`}>
                {cfg.label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{milestone.description}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-4">
            <span className="text-sm font-semibold">{milestone.amount} {}</span>
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-3">
                {/* Action buttons */}
                <div className="flex flex-wrap gap-2">
                  {role === 'freelancer' && milestone.status === 'pending' && (
                    <Button size="sm" onClick={() => onSubmit?.(milestone.id)}>
                      Submit for Review
                    </Button>
                  )}
                  {role === 'client' && milestone.status === 'in-review' && (
                    <>
                      <Button size="sm" variant="default" className="bg-green-600 hover:bg-green-700" onClick={() => onAccept?.(milestone.id)}>
                        Accept & Release
                      </Button>
                      <Button size="sm" variant="outline" className="border-red-500 text-red-500 hover:bg-red-50" onClick={() => setShowRejectInput((v) => !v)}>
                        Request Changes
                      </Button>
                    </>
                  )}
                </div>

                {/* Reject reason input */}
                {showRejectInput && (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Describe what needs to be changed..."
                      value={rejectText}
                      onChange={(e) => setRejectText(e.target.value)}
                      rows={2}
                      className="text-sm"
                    />
                    <Button size="sm" variant="outline" onClick={handleReject} disabled={!rejectText.trim()}>
                      Send Feedback
                    </Button>
                  </div>
                )}

                {/* Comment thread */}
                {milestone.comments.length > 0 && (
                  <div className="space-y-2 border-l-2 border-border pl-3">
                    {milestone.comments.map((c: MilestoneComment) => (
                      <div key={c.id} className="text-sm">
                        <span className={`font-medium capitalize ${c.author === 'client' ? 'text-blue-500' : 'text-green-500'}`}>
                          {c.author}:
                        </span>{' '}
                        <span className="text-foreground/80">{c.text}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* New comment */}
                {role && (
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Add a comment..."
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      rows={1}
                      className="text-sm min-h-[2.25rem] resize-none"
                    />
                    <Button size="icon" variant="ghost" onClick={handleComment} disabled={!commentText.trim()} aria-label="Send comment">
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function MilestoneTracker({
  milestones,
  role,
  onSubmit,
  onAccept,
  onReject,
  onComment,
}: MilestoneTrackerProps) {
  const total = milestones.length
  const completed = milestones.filter((m) => m.status === 'accepted' || m.status === 'released').length
  const progress = total > 0 ? (completed / total) * 100 : 0

  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="font-medium">Progress</span>
          <span className="text-muted-foreground">{completed} / {total} milestones</span>
        </div>
        {/* Animated progress bar */}
        <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <motion.div
            className="h-full rounded-full bg-green-500"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
        {/* Milestone markers */}
        <div className="relative mt-1" aria-hidden>
          <div className="flex justify-between">
            {milestones.map((m) => {
              const done = m.status === 'accepted' || m.status === 'released'
              return (
                <div key={m.id} className={`w-2 h-2 rounded-full ${done ? 'bg-green-500' : 'bg-muted-foreground/30'}`} title={m.title} />
              )
            })}
          </div>
        </div>
      </div>

      {/* Milestone list */}
      <div>
        {milestones.map((m, i) => (
          <MilestoneRow
            key={m.id}
            milestone={m}
            index={i}
            total={total}
            role={role}
            onSubmit={onSubmit}
            onAccept={onAccept}
            onReject={onReject}
            onComment={onComment}
          />
        ))}
      </div>
    </div>
  )
}
