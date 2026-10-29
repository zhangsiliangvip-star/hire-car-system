import { assignmentAction } from "@/lib/driver/assignment-action";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return assignmentAction(request, context, "event");
}
