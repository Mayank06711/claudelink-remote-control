// Package pty handles capturing terminal output from Claude Code processes.
// On Windows, this uses ConPTY. On Unix, it uses creack/pty.
package pty

import (
	"context"
	"fmt"
	"io"
	"log"
	"os/exec"
	"sync"
)

// OutputHandler is called whenever new terminal output is captured.
type OutputHandler func(data []byte)

// Session represents a captured terminal session running Claude Code.
type Session struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	stdout  io.ReadCloser
	handler OutputHandler
	mu      sync.Mutex
	done    chan struct{}
	NoStdin bool // If true, stdin is /dev/null (use for -p mode)
}

// NewSession creates a new PTY capture session for a Claude Code process.
// shellCmd is the command to run (e.g., "claude" or the path to claude CLI).
func NewSession(shellCmd string, args []string, handler OutputHandler) *Session {
	return &Session{
		cmd:     exec.Command(shellCmd, args...),
		handler: handler,
		done:    make(chan struct{}),
	}
}

// Start launches the Claude Code process and begins capturing output.
func (s *Session) Start(ctx context.Context) error {
	var err error

	if s.NoStdin {
		// -p mode: stdin not needed — use OS null device so Node.js
		// doesn't wait on an open pipe.
		s.cmd.Stdin = nil
	} else {
		s.stdin, err = s.cmd.StdinPipe()
		if err != nil {
			return fmt.Errorf("create stdin pipe: %w", err)
		}
	}

	s.stdout, err = s.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("create stdout pipe: %w", err)
	}

	// Capture stderr through a SEPARATE pipe.
	//
	// DO NOT use: s.cmd.Stderr = s.cmd.Stdout
	//
	// On Windows, assigning cmd.Stderr to the same *os.File that StdoutPipe()
	// stored in cmd.Stdout creates a duplicate OS handle for the pipe's write
	// end. When the process exits, Go closes one handle via closeAfterWait,
	// but the duplicate (from stderr) stays open. This prevents the stdout
	// pipe from ever returning EOF, so readFrom() blocks forever.
	stderrPipe, err := s.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("create stderr pipe: %w", err)
	}

	if err := s.cmd.Start(); err != nil {
		return fmt.Errorf("start claude process: %w", err)
	}

	// Read stdout and stderr in parallel, both feeding the same handler
	go s.readFrom(s.stdout)
	go s.readFrom(stderrPipe)

	// Wait for process exit in background
	go func() {
		s.cmd.Wait()
		close(s.done)
	}()

	log.Printf("Claude Code process started (PID: %d)", s.cmd.Process.Pid)
	return nil
}

// Write sends input to the Claude Code process stdin.
func (s *Session) Write(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.stdin == nil {
		return fmt.Errorf("stdin not available (NoStdin mode)")
	}
	_, err := s.stdin.Write(data)
	return err
}

// Done returns a channel that closes when the process exits.
func (s *Session) Done() <-chan struct{} {
	return s.done
}

// PID returns the process ID of the running command, or 0 if not started.
func (s *Session) PID() int {
	if s.cmd.Process != nil {
		return s.cmd.Process.Pid
	}
	return 0
}

// Stop terminates the Claude Code process.
func (s *Session) Stop() error {
	if s.cmd.Process != nil {
		return s.cmd.Process.Kill()
	}
	return nil
}

func (s *Session) readFrom(r io.Reader) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			// Make a copy before passing to handler (buffer gets reused)
			data := make([]byte, n)
			copy(data, buf[:n])
			s.handler(data)
		}
		if err != nil {
			if err != io.EOF {
				log.Printf("Read error: %v", err)
			}
			return
		}
	}
}
