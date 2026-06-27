import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ConnectPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border bg-surface">
        <CardHeader className="text-center">
          <CardTitle className="text-accent">TabbyRDP</CardTitle>
          <CardDescription>Scan the QR code with your phone to connect</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-48 items-center justify-center text-textMuted">
          QR panel placeholder
        </CardContent>
      </Card>
    </div>
  )
}
