# Product direction

PrivacyLens exists to make website privacy signals understandable. The product
should be useful to a curious visitor, a website team and a researcher, with a
shared foundation: every explanation can be traced to evidence.

## The foundation today

The web application includes a product homepage, a bundled synthetic sample
report and evidence labels for observed, inferred and unknown findings. The
developer collector runs against fixed local fixtures. The public scan route
returns 503; development routes return 404 in production.

The report covers recognized technologies, cookie metadata, third-party
destinations and possible consent manager signals. It observes the initial page
load without accepting or rejecting consent. A sample report is an illustration
of that contract, not a real-world measurement.

## Next: inspect a real website, locally first

The agreed sequence is a local CLI scanner (v0.1.0), then real scanner results in
the web interface (v0.2.0), then hosted scanning (v0.3.0). The CLI lets people
inspect a site they choose on their own machine, with all browser traffic passing
through an egress filter that refuses private and local addresses. Because it
runs on the user's machine, it is not the infrastructure isolation hosted
scanning needs. Hosted scanning requires infrastructure-enforced egress
restrictions, limits on resource use, abuse prevention and tests for redirects and
alternate address representations. These are release gates, not optional
improvements. The public web endpoint stays disabled until those gates are met.

## Then: stronger explanations and useful reports

Planned product directions include:

- Broader, fixture-backed technology coverage, with the evidence and uncertainty
  behind each detector.
- Accessible evidence exploration and clearer language for consent and network signals.
- Export and comparison of reports with explicit observation windows.
- Contribution documentation and eventually more languages.

These are priorities for discussion, not features currently available or dated
commitments. Changes to collection, storage or networking need their own design
and security review.

## Principles that travel with the product

1. Show observed evidence, supported inference and unknowns distinctly.
2. Make synthetic examples unmistakable.
3. Explain the observation window and consent state.
4. Collect and expose only the evidence needed to understand a finding.
5. Keep the interface accessible, readable on mobile and useful without motion.
6. Keep the project open to contribution and reproducible investigation.

The product provides technical observations. It does not provide legal
compliance verdicts, privacy scores or proof that a technology is absent.
