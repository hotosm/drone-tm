interface SectionHeaderProps {
  children?: React.ReactNode;
}

export default function SectionHeader({ children }: SectionHeaderProps) {
  return (
    <div
      style={{
        background: "linear-gradient(to right, #FFE6DE 0%, #E6F6F5 100%)",
      }}
    >
      <div className="naxatw-container !naxatw-max-w-full naxatw-py-6">
        <div className="naxatw-text-2xl">{children}</div>
      </div>
    </div>
  );
}
