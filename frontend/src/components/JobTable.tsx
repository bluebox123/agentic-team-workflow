import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { type Job } from "../api/jobs"
import { Play, Pause, XCircle } from "lucide-react"

interface JobTableProps {
    jobs: Job[]
    selectedJobId?: string
    onSelectJob: (job: Job) => void
    onAction: (action: string, jobId: string) => void
}

const statusVariant = (status: string) => {
    switch (status) {
        case "SUCCESS": return "default" // primary
        case "RUNNING": return "secondary" // blueish default
        case "FAILED": return "destructive"
        case "PENDING": return "outline"
        default: return "secondary"
    }
}

export function JobTable({ jobs, selectedJobId, onSelectJob, onAction }: JobTableProps) {
    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {jobs.map((job) => (
                        <TableRow
                            key={job.id}
                            className={selectedJobId === job.id ? "bg-muted/50" : "cursor-pointer"}
                            onClick={() => onSelectJob(job)}
                        >
                            <TableCell className="font-medium">
                                <div>{job.title}</div>
                                {job.template_name && (
                                    <div className="text-xs text-muted-foreground">
                                        {job.template_name} v{job.template_version}
                                    </div>
                                )}
                            </TableCell>
                            <TableCell>
                                <Badge variant={statusVariant(job.status) as any}>
                                    {job.status}
                                </Badge>
                            </TableCell>
                            <TableCell>{new Date(job.created_at).toLocaleString()}</TableCell>
                            <TableCell className="text-right">
                                <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                    {job.status === 'RUNNING' && (
                                        <>
                                            <Button size="icon" variant="ghost" onClick={() => onAction('pause', job.id)}>
                                                <Pause className="h-4 w-4" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => onAction('cancel', job.id)}>
                                                <XCircle className="h-4 w-4" />
                                            </Button>
                                        </>
                                    )}
                                    {job.status === 'PAUSED' && (
                                        <Button size="icon" variant="ghost" onClick={() => onAction('resume', job.id)}>
                                            <Play className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}
