import { z } from "zod";

// What the model must return. Dates and refs are plain strings here on purpose:
// one bad value should become a review flag in resolve.ts, not fail the whole run.
export const ExtractedTaskSchema = z.object({
  ref: z.string().min(1),
  title: z.string().min(3),
  owner_name: z.string().nullable(),
  due_date: z.string().nullable(),
  goal_id: z.string().nullable(),
  depends_on: z.array(z.string()).default([]),
  source_quote: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const ExtractionSchema = z.object({ tasks: z.array(ExtractedTaskSchema) });

export type ExtractedTask = z.infer<typeof ExtractedTaskSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

export interface TeamMember {
  id: string;
  name: string;
  aliases: string[];
  notionUserId?: string;
  slackUserId?: string;
}

export interface Goal {
  id: string;
  title: string;
  notionPageId?: string;
}

export interface ExistingTask {
  id: string;
  title: string;
  ownerId: string;
  due: string;
  notionPageId?: string;
}

export interface MeetingContext {
  meetingDate: string;
  meetingTitle: string;
  team: TeamMember[];
  goals: Goal[];
  existingTasks: ExistingTask[];
}

export interface ProposedTask {
  ref: string;
  title: string;
  ownerId: string | null;
  due: string | null;
  goalId: string | null;
  dependsOn: string[]; // refs of new tasks ("T2") or ids of existing tasks ("TASK-101")
  sourceQuote: string;
  confidence: number;
  reviewReasons: string[];
}
