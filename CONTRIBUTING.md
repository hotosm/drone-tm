# 🤗 Welcome

:+1::tada: First off, We are really glad you're reading this, because we need
volunteer developers to help improve the Drone Tasking Manager (Drone-TM)!
:tada::+1:

We welcome and encourage contributors of all skill levels, and we are committed
to making sure your participation is inclusive, enjoyable, and rewarding. If
you have never contributed to an open source project before, we are a good
place to start, and we will make sure you are supported every step of the way.
If you have **any** questions, please ask!

Furthermore, there are many ways to contribute to the
**Drone Tasking Manager (Drone-TM)**, which includes:

## Testing

Right now, we are in the process of building the prototype. We warmly welcome
your input in testing and sharing your feedback. If you are also interested in
coordinating a drone mapping session, please reach out!

## Code contributions

Create pull requests (PRs) for changes that you think are needed. We would
really appreciate your help!

Skills with the following would be beneficial:

- Python
- FastAPI
- HTML / CSS / JavaScript / React
- Docker / Kubernetes
- CI/CD workflows

## Report bugs and suggest improvements

The [issue queue][1] is the best way to get started. There are issue templates
for BUGs and FEATURES that you can use, you could also create your own.

Once you have submitted an issue, it will be assigned one label from the
following [label categories][2].

If you are wondering where to start, you can filter by the
**good first issue label**.

## Report security vulnerabilities

Please inform a maintainer as soon as possible, including the CVE code.

Message via the [HOTOSM Slack][7] or [direct email][8] would be preferred,
but via Github issue is also possible.

## :handshake: Thank you

Thank you very much in advance for your contributions!! Please ensure you refer
to our **Code of Conduct**.
If you've read the guidelines, but are still not sure how to contribute on
Github, please reach out to us via our Slack **#geospatial-tech-and-innovation**.

## Code Contribution guidelines

### Workflow

We operate the "Fork & Pull" model explained at [About Pull Requests][3]

Further details of our development workflow can be found [here][6]

### If you are reporting a problem

- Describe exactly what you were trying to achieve, what you did, what you
  expected to happen and what did happen instead. Include relevant information
  about the platform, OS version etc. you are using. Include shell commands you
  typed in, log files, errors messages etc.

- Please open a separate issue for each problem, question, or comment you have.
  Do not reuse existing issues for other topics, even if they are similar. This
  keeps issues small and manageable and makes it much easier to follow through
  and make sure each problem is taken care of.

### Documentation

Project documentation should be in [Markdown format][4], and in a _docs_
subdirectory. While it is possible to use HTML in Markdown documents
for tables and images, it is preferred to use the Markdown style as
it's much easier to read.

See a detailed guide on documentation contributions
[here](https://docs.hotosm.org/techdoc).

### Pre-Commit Hooks

[Pre-Commit Hooks][5] are used in this repo to enforce coding style:

- Python adheres mostly to PEP8 convention, amongst others, using the
  tool `ruff`.
- TypeScript / JavaScript code is formatted using `prettier`.
- Markdown files are formatted using `markdownlint`.
- Raq SQL is formatted using `sqlfluff`.

Please install the pre-commit hooks before contributing:

```bash
pip install pre-commit
pre-commit install
```

### Commit Sign-Off Policy

- In order to commit to this repository, please read and accept our
  [commit sign-off policy](https://developercertificate.org)
- This is simply to verify that you are the author of the commits you make.
- If possible, please add to your commit footer the `Signed-off-by` info:
  `Signed-off-by: John Doe <joe.doe@example.com>`

## Our Development Practices

To see more detail on the development practices used at HOT,
please visit [this page](https://docs.hotosm.org/dev-practices)

[1]: https://github.com/hotosm/drone-tm/issues "issue queue"
[2]: https://github.com/hotosm/drone-tm/labels "label categories"
[3]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests "About Pull Requests"
[4]: https://www.markdownguide.org/ "Markdown format"
[5]: https://pre-commit.com/ "Pre-commit"
[6]: https://github.com/hotosm/drone-tm/blob/main/CONTRIBUTING.md "Contributing Guide"
[7]: https://slack.hotosm.org "HOT Slack"
[8]: mailto:sysadmin@hotosm.org "Sysadmin email"
