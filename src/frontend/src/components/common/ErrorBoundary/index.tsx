import Icon from '@Components/common/Icon';
import { Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
  showError?: boolean;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: object | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    errorInfo: null,
  };

  constructor(props: ErrorBoundaryProps) {
    super(props);
    if (this.props.showError === false) {
      this.state.error = null;
      this.state.errorInfo = null;
    }
  }

  componentDidCatch(error: any, info: any) {
    this.setState({ error, errorInfo: info });
  }

  render() {
    if (this.state.errorInfo) {
      const [fileName, errorLocation] = (
        this.state.errorInfo as any
      ).componentStack
        .split('\n ')[1]
        .trim()
        .split(' (');
      return (
        <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-items-center naxatw-justify-center naxatw-gap-1 naxatw-bg-pink-200 naxatw-p-4">
          <div className="title naxatw-flex naxatw-flex-col naxatw-items-center naxatw-justify-center">
            <Icon
              name="running_with_errors"
              className="naxatw-text-red-600 naxatw-text-4xl"
            />
            <p className="naxatw-text-lg naxatw-font-bold naxatw-text-gray-800">
              {' '}
              An Error Occurred !
            </p>
          </div>
          <a
            href={errorLocation}
            target="_blank"
            rel="noopener noreferrer"
            className="naxatw-text-red-600 naxatw-text-sm naxatw-underline"
          >
            {fileName}
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
