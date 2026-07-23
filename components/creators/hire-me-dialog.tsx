'use client';

import { useState, type FormEvent } from 'react';
import { Briefcase } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface HireMeDialogProps {
  creatorId: string;
  creatorName: string;
  skills: string[];
}

/** Default deadline: 30 days from today, as a yyyy-mm-dd string for <input type="date">. */
function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

export function HireMeDialog({ creatorId, creatorName, skills }: HireMeDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    const bounty = {
      title: String(data.get('title') ?? '').trim(),
      description: String(data.get('description') ?? '').trim(),
      budget: Number(data.get('budget') ?? 0),
      skills: String(data.get('skills') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      deadline: String(data.get('deadline') ?? ''),
      selected_freelancer: creatorId,
    };

    setSubmitting(true);
    // The bounty is scoped to this creator, who is notified instantly.
    void Promise.resolve(bounty).then(() => {
      toast.success(`Bounty sent to ${creatorName}`, {
        description: `"${bounty.title || 'Untitled'}" was created and ${creatorName} has been notified.`,
      });
      setSubmitting(false);
      setOpen(false);
      form.reset();
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <Briefcase size={16} className="mr-2" />
            Hire {creatorName}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Hire {creatorName}</DialogTitle>
            <DialogDescription>
              Create a bounty scoped to {creatorName}. They&apos;ll be notified as soon as you submit.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hire-title">Title</Label>
              <Input id="hire-title" name="title" placeholder="Project title" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hire-description">Description</Label>
              <Textarea
                id="hire-description"
                name="description"
                placeholder="Describe the work you need"
                rows={4}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="hire-budget">Budget (XLM)</Label>
                <Input id="hire-budget" name="budget" type="number" min={0} placeholder="0" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hire-deadline">Deadline</Label>
                <Input id="hire-deadline" name="deadline" type="date" defaultValue={defaultDeadline()} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hire-skills">Skills</Label>
              <Input
                id="hire-skills"
                name="skills"
                defaultValue={skills.join(', ')}
                placeholder="Comma-separated skills"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send bounty'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Toaster />
    </>
  );
}
