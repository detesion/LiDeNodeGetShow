export function Footer({ text, repo }: { text?: string; repo?: string; dist_page?: string }) {
  return (
    <footer className="border-t">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex justify-end gap-4 text-xs text-muted-foreground">
        {repo ? (
          <a href={repo} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">
            {text || 'Powered by NodeGet'}
          </a>
        ) : (
          <span>{text || 'Powered by NodeGet'}</span>
        )}
        <a
          href={`/NodeGet-StatusShow-v${__APP_VERSION__}.zip`}
          target="_blank"
          rel="noreferrer"
          className="hover:text-primary transition-colors"
        >
          v{__APP_VERSION__}
        </a>
      </div>
    </footer>
  )
}
