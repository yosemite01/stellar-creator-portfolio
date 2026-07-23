"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkillCombobox } from "@/components/ui/skill-combobox";
import { CreatorCard } from "@/components/cards/creator-card";
import { creators, bounties } from "@/lib/services/creators-data";
import { trackEvent, trackConversion } from "@/lib/analytics/analytics";

const TOTAL_STEPS = 3;

const roleSchema = z.object({
  role: z.enum(["CREATOR", "CLIENT"]),
});

const creatorSchema = z.object({
  displayName: z.string().min(2).max(30),
  discipline: z.string().min(1, "Select a discipline"),
  skills: z.array(z.string()).min(1, "Add at least one skill").max(5),
  avatar: z.string().url().optional().or(z.literal("")),
});

const clientSchema = z.object({
  companyName: z.string().min(2).max(80),
  projectType: z.string().min(1),
  budgetRange: z.string().min(1),
});

const DISCIPLINES = ["Design", "Development", "Writing", "Marketing", "Video"];
const PROJECT_TYPES = ["Web App", "Mobile App", "Brand Design", "Content", "Other"];
const BUDGET_RANGES = ["<$1k", "$1k–$5k", "$5k–$20k", "$20k+"];

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<"CREATOR" | "CLIENT" | null>(null);
  const [loading, setLoading] = useState(true);

  const roleForm = useForm<z.infer<typeof roleSchema>>({
    resolver: zodResolver(roleSchema),
    defaultValues: { role: "CREATOR" },
  });

  const creatorForm = useForm<z.infer<typeof creatorSchema>>({
    resolver: zodResolver(creatorSchema),
    defaultValues: { displayName: "", discipline: "", skills: [], avatar: "" },
  });

  const clientForm = useForm<z.infer<typeof clientSchema>>({
    resolver: zodResolver(clientSchema),
    defaultValues: { companyName: "", projectType: "", budgetRange: "" },
  });

  const persistStep = useCallback(async (nextStep: number, extra?: Record<string, unknown>) => {
    await fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: nextStep, data: extra, role: role ?? undefined }),
    });
  }, [role]);

  useEffect(() => {
    fetch("/api/onboarding")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.onboardingCompletedAt) {
          router.replace("/dashboard");
          return;
        }
        if (data?.onboardingStep) setStep(Math.min(data.onboardingStep, TOTAL_STEPS));
        if (data?.role === "CREATOR" || data?.role === "CLIENT") setRole(data.role);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  const goToStep = async (next: number) => {
    setStep(next);
    await persistStep(next);
    trackEvent("onboarding_step", { step: next, role: role ?? "unset" });
  };

  const onRoleSubmit = async (values: z.infer<typeof roleSchema>) => {
    setRole(values.role);
    await fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: 2, role: values.role }),
    });
    trackEvent("onboarding_step_complete", { step: 1, role: values.role });
    setStep(2);
  };

  const onProfileSubmit = async (profile: Record<string, unknown>) => {
    if (!role) return;
    await fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: 3, data: profile, role }),
    });
    trackEvent("onboarding_step_complete", { step: 2, role });
    setStep(3);
  };

  const completeOnboarding = async (skipFeatured = false) => {
    const profile =
      role === "CREATOR"
        ? creatorForm.getValues()
        : clientForm.getValues();

    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, profile }),
    });

    trackConversion("signup", { role, skippedFeatured: skipFeatured });
    trackEvent("onboarding_complete", { role });
    router.push(role === "CREATOR" ? "/bounties" : "/creators");
  };

  if (loading) {
    return <div className="container max-w-2xl py-16 text-center text-muted-foreground">Loading…</div>;
  }

  const progressValue = (step / TOTAL_STEPS) * 100;

  return (
    <div className="container max-w-2xl py-10 space-y-8">
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Step {step} of {TOTAL_STEPS}</span>
          <Link href="/" className="hover:underline" onClick={() => trackEvent("onboarding_skip", { step })}>
            Skip for now
          </Link>
        </div>
        <Progress value={progressValue} className="h-2" />
      </div>

      {step === 1 && (
        <Form {...roleForm}>
          <form onSubmit={roleForm.handleSubmit(onRoleSubmit)} className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold">Welcome! Choose your path</h1>
              <p className="text-muted-foreground mt-1">
                Are you here to offer services or hire creators?
              </p>
            </div>
            <FormField
              control={roleForm.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(["CREATOR", "CLIENT"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => field.onChange(r)}
                        className={`rounded-lg border p-6 text-left transition-colors ${
                          field.value === r ? "border-primary bg-primary/5" : "hover:border-muted-foreground/40"
                        }`}
                      >
                        <p className="font-semibold">{r === "CREATOR" ? "Creator" : "Client"}</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {r === "CREATOR"
                            ? "I offer services and apply to bounties"
                            : "I hire creators and post bounties"}
                        </p>
                      </button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit">Continue</Button>
          </form>
        </Form>
      )}

      {step === 2 && role === "CREATOR" && (
        <Form {...creatorForm}>
          <form
            onSubmit={creatorForm.handleSubmit((v) => onProfileSubmit(v))}
            className="space-y-6"
          >
            <div>
              <h1 className="text-2xl font-bold">Set up your creator profile</h1>
              <p className="text-muted-foreground mt-1">Tell clients who you are and what you do.</p>
            </div>
            <FormField
              control={creatorForm.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display name</FormLabel>
                  <FormControl><Input placeholder="Your name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={creatorForm.control}
              name="discipline"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Discipline</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select discipline" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DISCIPLINES.map((d) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={creatorForm.control}
              name="skills"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Top skills (up to 5)</FormLabel>
                  <FormControl>
                    <SkillCombobox value={field.value} onChange={field.onChange} maxItems={5} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={creatorForm.control}
              name="avatar"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Avatar URL (optional)</FormLabel>
                  <FormControl><Input placeholder="https://…" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={() => goToStep(1)}>Back</Button>
              <Button type="submit">Continue</Button>
            </div>
          </form>
        </Form>
      )}

      {step === 2 && role === "CLIENT" && (
        <Form {...clientForm}>
          <form
            onSubmit={clientForm.handleSubmit((v) => onProfileSubmit(v))}
            className="space-y-6"
          >
            <div>
              <h1 className="text-2xl font-bold">Tell us about your company</h1>
              <p className="text-muted-foreground mt-1">Help us match you with the right creators.</p>
            </div>
            <FormField
              control={clientForm.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company name</FormLabel>
                  <FormControl><Input placeholder="Acme Inc." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={clientForm.control}
              name="projectType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PROJECT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={clientForm.control}
              name="budgetRange"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Budget range</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select budget" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {BUDGET_RANGES.map((b) => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={() => goToStep(1)}>Back</Button>
              <Button type="submit">Continue</Button>
            </div>
          </form>
        </Form>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">
              {role === "CREATOR" ? "Featured bounties" : "Top creators"}
            </h1>
            <p className="text-muted-foreground mt-1">
              {role === "CREATOR"
                ? "Browse open bounties and apply to get started."
                : "Explore top-rated creators ready for your next project."}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-1">
            {role === "CREATOR"
              ? bounties.slice(0, 3).map((b) => (
                  <Link
                    key={b.id}
                    href={`/bounties/${b.id}`}
                    className="block rounded-lg border p-4 hover:border-primary transition-colors"
                  >
                    <p className="font-semibold">{b.title}</p>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{b.description}</p>
                    <p className="text-sm font-medium mt-2">${b.budget.toLocaleString()}</p>
                  </Link>
                ))
              : creators.slice(0, 3).map((c) => (
                  <CreatorCard key={c.id} creator={c} />
                ))}
          </div>
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => goToStep(2)}>Back</Button>
            <Button onClick={() => completeOnboarding(false)}>Get started</Button>
          </div>
        </div>
      )}
    </div>
  );
}
