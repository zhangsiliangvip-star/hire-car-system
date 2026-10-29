import DriverTrips from "@/app/driver/trips";

export default async function DriverOrder({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ assignmentId?: string }>;
}) {
  const { id } = await params;
  const { assignmentId } = await searchParams;
  return <DriverTrips orderId={id} assignmentId={assignmentId ?? ""} />;
}
