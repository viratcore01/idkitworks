interface EmptyStateProps {
 icon: React.ReactNode;
 title: string;
 description?: string;
 action?: React.ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
 return (
 <div className="text-center py-12">
 <div className="w-16 h-16 mx-auto mb-4 bg-white border-nb-2 border-ink shadow-nb-sm flex items-center justify-center text-ink [&_svg]:w-7 [&_svg]:h-7">
 {icon}
 </div>
 <h3 className="font-display font-bold text-lg text-ink">{title}</h3>
 {description && (
 <p className="mt-2 font-body text-sm text-gray-500 max-w-sm mx-auto">{description}</p>
 )}
 {action && <div className="mt-4">{action}</div>}
 </div>
 );
}
