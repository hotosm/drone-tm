import html2canvas from 'html2canvas';

interface ICaptureComponentProps {
  componentRef: React.RefObject<any>;
  captureName: string;
}

export default function CaptureComponent({
  componentRef,
  captureName,
}: ICaptureComponentProps) {
  const style = document.createElement('style');
  document.head.appendChild(style);
  style.sheet?.insertRule(
    'body > div:last-child img { display: inline-block; }',
  );

  const elementToRemove = componentRef.current.querySelector('.actions');
  const parentElement = elementToRemove.parentNode;
  parentElement.removeChild(elementToRemove);
  html2canvas(componentRef.current).then((canvas: any) => {
    const link = document.createElement('a');
    link.download = captureName;
    link.href = canvas.toDataURL();
    link.click();

    parentElement.appendChild(elementToRemove);
  });
}
